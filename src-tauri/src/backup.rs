use crate::db::{get_connection, get_db_path};
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_BACKUPS: usize = 10;
const AUTO_BACKUP_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub name: String,
    pub size_bytes: u64,
    // Milliseconds since the Unix epoch — the frontend formats it locally.
    pub created_at_ms: u64,
}

fn backups_dir() -> Result<PathBuf, String> {
    let db_path = get_db_path();
    let dir = db_path
        .parent()
        .ok_or("Database path has no parent directory")?
        .join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Backup names are user-visible and later come back through the restore API,
// so they must never be usable for path traversal.
fn validate_backup_name(name: &str) -> Result<(), String> {
    let valid = name.ends_with(".db")
        && !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.contains("..");
    if valid {
        Ok(())
    } else {
        Err("Invalid backup name".to_string())
    }
}

pub fn create_backup(label: &str) -> Result<BackupInfo, String> {
    let dir = backups_dir()?;

    let conn = get_connection().map_err(|e| e.to_string())?;
    // Let SQLite produce the timestamp so it matches the DB's own clock.
    let stamp: String = conn
        .query_row(
            "SELECT strftime('%Y%m%d-%H%M%S', 'now', 'localtime')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut name = format!("songs-{}-{}.db", stamp, label);
    validate_backup_name(&name)?;
    let mut path = dir.join(&name);
    // Two backups within the same second (e.g. pre-restore right after a
    // manual one): VACUUM INTO refuses to overwrite, so uniquify the name.
    let mut counter = 2;
    while path.exists() {
        name = format!("songs-{}-{}-{}.db", stamp, label, counter);
        path = dir.join(&name);
        counter += 1;
    }

    // VACUUM INTO writes a consistent, compacted snapshot without blocking
    // the live connection on anything but this statement.
    conn.execute("VACUUM INTO ?1", params![path.to_string_lossy()])
        .map_err(|e| e.to_string())?;
    drop(conn);

    prune_old_backups(&dir)?;

    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(BackupInfo {
        name,
        size_bytes: meta.len(),
        created_at_ms: modified_ms(&meta),
    })
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn list_backups() -> Result<Vec<BackupInfo>, String> {
    let dir = backups_dir()?;
    let mut backups: Vec<BackupInfo> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("songs-") || !name.ends_with(".db") {
                return None;
            }
            let meta = entry.metadata().ok()?;
            Some(BackupInfo {
                name,
                size_bytes: meta.len(),
                created_at_ms: modified_ms(&meta),
            })
        })
        .collect();

    backups.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    Ok(backups)
}

fn prune_old_backups(dir: &PathBuf) -> Result<(), String> {
    let backups = list_backups()?;
    for stale in backups.iter().skip(MAX_BACKUPS) {
        let _ = fs::remove_file(dir.join(&stale.name));
    }
    Ok(())
}

pub fn restore_backup(name: &str) -> Result<(), String> {
    validate_backup_name(name)?;
    let path = backups_dir()?.join(name);
    if !path.exists() {
        return Err("Backup not found".to_string());
    }

    // The current state might be wanted back — restoring is itself undoable.
    create_backup("pre-restore")?;

    let src = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Could not open backup: {}", e))?;

    {
        let mut dst = get_connection().map_err(|e| e.to_string())?;
        let backup = rusqlite::backup::Backup::new(&src, &mut dst)
            .map_err(|e| e.to_string())?;
        backup
            .run_to_completion(100, Duration::from_millis(10), None)
            .map_err(|e| e.to_string())?;
    }

    // The backup may predate newer schema — re-run the idempotent migrations.
    crate::db::init_db().map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_util::setup_temp_db;
    use crate::models::{Song, Verse};
    use crate::songs::{create_song, delete_song, get_all_songs};

    fn simple_song(title: &str) -> Song {
        Song {
            id: None,
            title: title.to_string(),
            author: None,
            musical_key: None,
            song_number: None,
            verses: vec![Verse {
                id: None,
                label: "Verse 1".to_string(),
                text: format!("{} words", title),
                position: None,
            }],
            tags: Vec::new(),
        }
    }

    #[test]
    fn backup_and_restore_roundtrip() {
        let _db = setup_temp_db();

        create_song(&simple_song("Kept Song")).expect("create");
        let info = create_backup("test").expect("backup");
        assert!(info.size_bytes > 0);
        assert!(list_backups().unwrap().iter().any(|b| b.name == info.name));

        // Mutate the library after the snapshot…
        let doomed = create_song(&simple_song("Added After Backup")).expect("create");
        delete_song(doomed).ok();
        let all: Vec<String> = get_all_songs("title")
            .unwrap()
            .into_iter()
            .map(|s| s.title)
            .collect();
        assert_eq!(all, vec!["Kept Song"]);

        create_song(&simple_song("Another Late Arrival")).expect("create");
        assert_eq!(get_all_songs("title").unwrap().len(), 2);

        // …and the restore brings back exactly the snapshotted state.
        restore_backup(&info.name).expect("restore");
        let titles: Vec<String> = get_all_songs("title")
            .unwrap()
            .into_iter()
            .map(|s| s.title)
            .collect();
        assert_eq!(titles, vec!["Kept Song"]);

        // The restore itself left a recovery point behind.
        assert!(list_backups()
            .unwrap()
            .iter()
            .any(|b| b.name.contains("pre-restore")));

        assert!(restore_backup("../outside.db").is_err());
        assert!(restore_backup("songs-nonexistent.db").is_err());
    }
}

// Daily safety net, called once at startup. Failures are non-fatal: a broken
// backup directory must never stop the app from opening on a Sunday morning.
pub fn auto_backup_if_due() -> Result<(), String> {
    let newest = list_backups()?.into_iter().next();
    let due = match newest {
        None => true,
        Some(info) => {
            let age = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|now| now.as_millis() as u64)
                .unwrap_or(0)
                .saturating_sub(info.created_at_ms);
            Duration::from_millis(age) >= AUTO_BACKUP_INTERVAL
        }
    };
    if due {
        create_backup("auto")?;
    }
    Ok(())
}
