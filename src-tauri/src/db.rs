use once_cell::sync::OnceCell;
use rusqlite::{Connection, Result as SqliteResult};
use std::path::PathBuf;
use std::sync::Mutex;

static DB_PATH: OnceCell<PathBuf> = OnceCell::new();
static DB_POOL: OnceCell<Mutex<Connection>> = OnceCell::new();

pub fn init_db_path() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let new_dir = base.join("HymnBeam");
    let old_dir = base.join("Song Rays");
    // One-time migration of the pre-rename data directory. Only happens when
    // the old name exists and the new one hasn't been created yet.
    if old_dir.exists() && !new_dir.exists() {
        let _ = std::fs::rename(&old_dir, &new_dir);
    }
    std::fs::create_dir_all(&new_dir).ok();
    new_dir.join("songs.db")
}

pub fn set_db_path(path: PathBuf) {
    DB_PATH.set(path).ok();
}

pub fn get_db_path() -> PathBuf {
    DB_PATH.get().cloned().unwrap_or_else(init_db_path)
}

pub fn get_connection() -> SqliteResult<std::sync::MutexGuard<'static, Connection>> {
    let pool = DB_POOL.get_or_init(|| {
        let conn = Connection::open(get_db_path()).expect("Failed to open database");
        conn.execute_batch("PRAGMA foreign_keys = ON;").ok();
        Mutex::new(conn)
    });
    Ok(pool.lock().unwrap())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> SqliteResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .any(|name| name == column);
    Ok(exists)
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> SqliteResult<()> {
    if !column_exists(conn, table, column)? {
        conn.execute(
            &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition),
            [],
        )?;
    }
    Ok(())
}

// Order-of-service migration: setlist entries used to be songs only. Rebuild
// the table so an entry can also be a Bible passage or a logo slide — this
// needs song_id to become nullable, which SQLite can't do with ALTER, so we
// copy into a new table. Guarded on the item_type column so it runs once.
// setlist_songs is referenced by nothing, so the rebuild is safe with FKs on.
fn migrate_setlist_items(conn: &Connection) -> SqliteResult<()> {
    if column_exists(conn, "setlist_songs", "item_type")? {
        return Ok(());
    }
    conn.execute_batch(
        r#"
        CREATE TABLE setlist_songs_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setlist_id INTEGER NOT NULL,
            song_id INTEGER,
            item_type TEXT NOT NULL DEFAULT 'song',
            reference TEXT,
            position INTEGER NOT NULL,
            FOREIGN KEY (setlist_id) REFERENCES setlists(id) ON DELETE CASCADE,
            FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
        );
        INSERT INTO setlist_songs_new (id, setlist_id, song_id, item_type, position)
            SELECT id, setlist_id, song_id, 'song', position FROM setlist_songs;
        DROP TABLE setlist_songs;
        ALTER TABLE setlist_songs_new RENAME TO setlist_songs;
        "#,
    )?;
    Ok(())
}

pub fn init_db() -> SqliteResult<()> {
    let conn = get_connection()?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT,
            musical_key TEXT,
            song_number TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS verses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_id INTEGER NOT NULL,
            label TEXT NOT NULL,
            text TEXT NOT NULL,
            position INTEGER NOT NULL,
            FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        );

        CREATE TABLE IF NOT EXISTS song_tags (
            song_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (song_id, tag_id),
            FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS setlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS setlist_songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setlist_id INTEGER NOT NULL,
            song_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            FOREIGN KEY (setlist_id) REFERENCES setlists(id) ON DELETE CASCADE,
            FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
        CREATE INDEX IF NOT EXISTS idx_verses_song_id ON verses(song_id);

        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL
        );
        "#,
    )?;

    // Migration for databases created before song_number existed as a column.
    // Must run before any index that references the column.
    add_column_if_missing(&conn, "songs", "song_number", "TEXT")?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_songs_number ON songs(song_number);",
    )?;

    // Soft-delete support: trashed songs carry a timestamp and are filtered
    // out of every read path until restored or purged.
    add_column_if_missing(&conn, "songs", "deleted_at", "TIMESTAMP")?;

    // Provenance: an optional free-text label for where a song came from
    // (e.g. "BCF Scotland"). Set on import and editable per song or in batch.
    add_column_if_missing(&conn, "songs", "source", "TEXT")?;

    // Order-of-service: setlist entries can be songs, Bible passages or logo slides.
    migrate_setlist_items(&conn)?;

    conn.execute_batch(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
            title,
            author,
            content='songs',
            content_rowid='id'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS verses_fts USING fts5(
            text,
            content='verses',
            content_rowid='id'
        );

        CREATE TABLE IF NOT EXISTS bible_verses (
            id      INTEGER PRIMARY KEY,
            book    TEXT    NOT NULL,
            name    TEXT    NOT NULL,
            chapter INTEGER NOT NULL,
            verse   INTEGER NOT NULL,
            text    TEXT    NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_bible_bk_ch
            ON bible_verses(book, chapter);

        CREATE VIRTUAL TABLE IF NOT EXISTS bible_fts USING fts5(
            text,
            content='bible_verses',
            content_rowid='id'
        );
        "#,
    )?;

    crate::bible::ensure_bible_loaded(&conn)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::test_util::setup_temp_db;
    use super::{column_exists, get_connection, migrate_setlist_items};

    #[test]
    fn setlist_migration_upgrades_old_shape_and_preserves_rows() {
        let _db = setup_temp_db();
        let conn = get_connection().unwrap();

        // Recreate the pre-migration table shape (song-only, song_id NOT NULL)
        // with an existing entry, to simulate upgrading an older database.
        conn.execute_batch(
            r#"
            DROP TABLE setlist_songs;
            CREATE TABLE setlist_songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setlist_id INTEGER NOT NULL,
                song_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                FOREIGN KEY (setlist_id) REFERENCES setlists(id) ON DELETE CASCADE,
                FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
            );
            INSERT INTO setlists (id, name) VALUES (1, 'Old Service');
            INSERT INTO songs (id, title) VALUES (1, 'Old Song');
            INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES (1, 1, 1);
            "#,
        )
        .unwrap();
        assert!(!column_exists(&conn, "setlist_songs", "item_type").unwrap());

        migrate_setlist_items(&conn).unwrap();

        // The new columns exist and the existing row survived as a 'song' entry.
        assert!(column_exists(&conn, "setlist_songs", "item_type").unwrap());
        assert!(column_exists(&conn, "setlist_songs", "reference").unwrap());
        let (item_type, song_id): (String, i64) = conn
            .query_row(
                "SELECT item_type, song_id FROM setlist_songs WHERE setlist_id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(item_type, "song");
        assert_eq!(song_id, 1);

        // song_id is now nullable, so bible/logo entries can be inserted.
        conn.execute(
            "INSERT INTO setlist_songs (setlist_id, song_id, item_type, reference, position)
             VALUES (1, NULL, 'bible', 'John 3:16', 2)",
            [],
        )
        .unwrap();

        // Migration is idempotent — a second run is a no-op.
        migrate_setlist_items(&conn).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM setlist_songs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
    }
}

#[cfg(test)]
pub mod test_util {
    use std::sync::{Mutex, MutexGuard};

    // The db path/pool are process-wide OnceCells, so every test in this
    // binary shares one database. Tests that touch it hold this lock and
    // start from an empty library.
    static DB_LOCK: Mutex<()> = Mutex::new(());

    pub fn setup_temp_db() -> MutexGuard<'static, ()> {
        let guard = DB_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let path = std::env::temp_dir().join(format!(
            "hymnbeam-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        super::set_db_path(path);
        super::init_db().expect("init test db");
        crate::songs::clear_all_songs().expect("start from an empty library");
        // The connection pool is a process-wide OnceCell, so a "fresh" path
        // can't actually re-open the DB — every test shares one file. Reset the
        // collection tables too (clear_all_songs only clears songs/tags) so
        // tests stay isolated regardless of run order.
        {
            let conn = super::get_connection().expect("connection");
            conn.execute_batch("DELETE FROM setlists;")
                .expect("clear setlists");
        }
        guard
    }
}
