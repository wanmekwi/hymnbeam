use crate::db::get_connection;
use crate::models::{DeletedSongSummary, DuplicateGroup, DuplicateSong, Song, SongSummary, Verse};
use rusqlite::params;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

fn get_sort_clause(sort_by: &str) -> &'static str {
    match sort_by {
        "title" => "s.title ASC",
        // Numbered songs first (in numeric order), then anything without a
        // song_number falls back to insertion order.
        "number" => "(s.song_number IS NULL OR s.song_number = '') ASC, \
                     CAST(s.song_number AS INTEGER) ASC, s.song_number ASC, s.id ASC",
        "key" => "s.musical_key ASC, s.title ASC",
        "author" => "s.author ASC, s.title ASC",
        "recent" => "s.id DESC",
        _ => "s.title ASC",
    }
}

// Returns the id of any song that already owns `number`, or None. The check
// is trim-aware because the UI typically stores trimmed values but legacy
// imports may have whitespace. Empty/whitespace-only numbers never conflict.
pub fn find_song_id_by_number(number: &str) -> Result<Option<i64>, String> {
    let trimmed = number.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let conn = get_connection().map_err(|e| e.to_string())?;
    let id: rusqlite::Result<i64> = conn.query_row(
        "SELECT id FROM songs WHERE TRIM(song_number) = ?1 AND deleted_at IS NULL LIMIT 1",
        params![trimmed],
        |row| row.get(0),
    );
    match id {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// The next number to assign when appending a song to the end of the library:
// one past the highest numeric song_number in use. Non-numeric numbers CAST to
// 0 in SQLite so they never inflate the max, and trashed rows are ignored.
// Returns 1 for an empty (or entirely unnumbered) library.
pub fn next_song_number() -> Result<i64, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let max: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(CAST(song_number AS INTEGER)), 0) FROM songs WHERE deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(max + 1)
}

// Batch-assign a provenance label to live songs. With `only_untagged` true only
// songs that have no source yet are touched (the "tag my original library"
// case); otherwise every live song is overwritten. A blank source clears it.
// Returns how many rows changed.
pub fn set_source(source: Option<&str>, only_untagged: bool) -> Result<usize, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let value = source.map(|s| s.trim()).filter(|s| !s.is_empty());
    let sql = if only_untagged {
        "UPDATE songs SET source = ?1, updated_at = CURRENT_TIMESTAMP \
         WHERE deleted_at IS NULL AND (source IS NULL OR TRIM(source) = '')"
    } else {
        "UPDATE songs SET source = ?1, updated_at = CURRENT_TIMESTAMP WHERE deleted_at IS NULL"
    };
    let n = conn.execute(sql, params![value]).map_err(|e| e.to_string())?;
    Ok(n)
}

pub fn create_song(song: &Song) -> Result<i64, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO songs (title, author, musical_key, song_number, source) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![song.title, song.author, song.musical_key, song.song_number, song.source],
    )
    .map_err(|e| e.to_string())?;

    let song_id = conn.last_insert_rowid();

    conn.execute(
        "INSERT INTO songs_fts (rowid, title, author) VALUES (?1, ?2, ?3)",
        params![song_id, song.title, song.author.as_deref().unwrap_or("")],
    )
    .map_err(|e| e.to_string())?;

    for (i, verse) in song.verses.iter().enumerate() {
        conn.execute(
            "INSERT INTO verses (song_id, label, text, position) VALUES (?1, ?2, ?3, ?4)",
            params![song_id, verse.label, verse.text, i as i32],
        )
        .map_err(|e| e.to_string())?;

        let verse_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO verses_fts (rowid, text) VALUES (?1, ?2)",
            params![verse_id, verse.text],
        )
        .map_err(|e| e.to_string())?;
    }

    for tag_name in &song.tags {
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", params![tag_name])
            .map_err(|e| e.to_string())?;

        let tag_id: i64 = conn
            .query_row("SELECT id FROM tags WHERE name = ?1", params![tag_name], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?1, ?2)",
            params![song_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(song_id)
}

pub fn get_song(song_id: i64) -> Result<Option<Song>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let song_result: Result<
        (String, Option<String>, Option<String>, Option<String>, Option<String>),
        _,
    > = conn.query_row(
        "SELECT title, author, musical_key, song_number, source FROM songs
             WHERE id = ?1 AND deleted_at IS NULL",
        params![song_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    );

    let (title, author, musical_key, song_number, source) = match song_result {
        Ok(s) => s,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };

    let mut stmt = conn
        .prepare("SELECT id, label, text, position FROM verses WHERE song_id = ?1 ORDER BY position")
        .map_err(|e| e.to_string())?;

    let verses: Vec<Verse> = stmt
        .query_map(params![song_id], |row| {
            Ok(Verse {
                id: Some(row.get(0)?),
                label: row.get(1)?,
                text: row.get(2)?,
                position: Some(row.get(3)?),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut stmt = conn
        .prepare(
            "SELECT t.name FROM tags t JOIN song_tags st ON t.id = st.tag_id WHERE st.song_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let tags: Vec<String> = stmt
        .query_map(params![song_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Some(Song {
        id: Some(song_id),
        title,
        author,
        musical_key,
        song_number,
        source,
        verses,
        tags,
    }))
}

pub fn get_all_songs(sort_by: &str) -> Result<Vec<SongSummary>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let order_clause = get_sort_clause(sort_by);

    let query = format!(
        r#"
        SELECT s.id, s.title, s.author, s.musical_key, s.song_number, s.source, COUNT(v.id) as verse_count
        FROM songs s
        LEFT JOIN verses v ON s.id = v.song_id
        WHERE s.deleted_at IS NULL
        GROUP BY s.id
        ORDER BY {}
        "#,
        order_clause
    );

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let songs: Vec<SongSummary> = stmt
        .query_map([], |row| {
            Ok(SongSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                musical_key: row.get(3)?,
                song_number: row.get(4)?,
                source: row.get(5)?,
                verse_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(songs)
}

pub fn search_songs(query: &str, sort_by: &str) -> Result<Vec<SongSummary>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let order_clause = get_sort_clause(sort_by);
    let fts_term = format!("{}*", query);

    let fts_query = format!(
        r#"
        SELECT DISTINCT s.id, s.title, s.author, s.musical_key, s.song_number, s.source, COUNT(v.id) as verse_count
        FROM songs s
        LEFT JOIN verses v ON s.id = v.song_id
        WHERE s.deleted_at IS NULL AND (s.id IN (
            SELECT rowid FROM songs_fts WHERE songs_fts MATCH ?1
        ) OR s.id IN (
            SELECT song_id FROM verses WHERE id IN (
                SELECT rowid FROM verses_fts WHERE verses_fts MATCH ?1
            )
        ))
        GROUP BY s.id
        ORDER BY {}
        "#,
        order_clause
    );

    // Try FTS first. A malformed MATCH expression (user typed an FTS operator
    // like `"` or `(`) errors at execution; treat that as "no FTS results" and
    // fall through to the LIKE search rather than failing the request.
    let fts_result: rusqlite::Result<Vec<SongSummary>> = (|| {
        let mut stmt = conn.prepare(&fts_query)?;
        let rows = stmt.query_map(params![fts_term], |row| {
            Ok(SongSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                musical_key: row.get(3)?,
                song_number: row.get(4)?,
                source: row.get(5)?,
                verse_count: row.get(6)?,
            })
        })?;
        rows.collect()
    })();

    if let Ok(songs) = fts_result {
        if !songs.is_empty() {
            return Ok(songs);
        }
    }

    let like_term = format!("%{}%", query);
    let fallback_query = format!(
        r#"
        SELECT DISTINCT s.id, s.title, s.author, s.musical_key, s.song_number, s.source, COUNT(v.id) as verse_count
        FROM songs s
        LEFT JOIN verses v ON s.id = v.song_id
        WHERE s.deleted_at IS NULL AND (s.title LIKE ?1 COLLATE NOCASE
           OR s.author LIKE ?1 COLLATE NOCASE
           OR s.musical_key LIKE ?1 COLLATE NOCASE
           OR s.song_number LIKE ?1
           OR CAST(s.id AS TEXT) LIKE ?1
           OR EXISTS (SELECT 1 FROM verses v2 WHERE v2.song_id = s.id AND v2.text LIKE ?1 COLLATE NOCASE))
        GROUP BY s.id
        ORDER BY {}
        "#,
        order_clause
    );

    let mut stmt = conn.prepare(&fallback_query).map_err(|e| e.to_string())?;
    let songs: Vec<SongSummary> = stmt
        .query_map(params![like_term], |row| {
            Ok(SongSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                musical_key: row.get(3)?,
                song_number: row.get(4)?,
                source: row.get(5)?,
                verse_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(songs)
}

pub fn update_song(song_id: i64, song: &Song) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let rows_updated = conn
        .execute(
            "UPDATE songs SET title = ?1, author = ?2, musical_key = ?3, song_number = ?4, source = ?5, updated_at = CURRENT_TIMESTAMP WHERE id = ?6 AND deleted_at IS NULL",
            params![song.title, song.author, song.musical_key, song.song_number, song.source, song_id],
        )
        .map_err(|e| e.to_string())?;

    if rows_updated == 0 {
        return Ok(false);
    }

    conn.execute(
        "UPDATE songs_fts SET title = ?1, author = ?2 WHERE rowid = ?3",
        params![song.title, song.author.as_deref().unwrap_or(""), song_id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id FROM verses WHERE song_id = ?1")
        .map_err(|e| e.to_string())?;
    let old_verse_ids: Vec<i64> = stmt
        .query_map(params![song_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for vid in old_verse_ids {
        conn.execute("DELETE FROM verses_fts WHERE rowid = ?1", params![vid])
            .map_err(|e| e.to_string())?;
    }

    conn.execute("DELETE FROM verses WHERE song_id = ?1", params![song_id])
        .map_err(|e| e.to_string())?;

    for (i, verse) in song.verses.iter().enumerate() {
        conn.execute(
            "INSERT INTO verses (song_id, label, text, position) VALUES (?1, ?2, ?3, ?4)",
            params![song_id, verse.label, verse.text, i as i32],
        )
        .map_err(|e| e.to_string())?;

        let verse_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO verses_fts (rowid, text) VALUES (?1, ?2)",
            params![verse_id, verse.text],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute("DELETE FROM song_tags WHERE song_id = ?1", params![song_id])
        .map_err(|e| e.to_string())?;

    for tag_name in &song.tags {
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", params![tag_name])
            .map_err(|e| e.to_string())?;

        let tag_id: i64 = conn
            .query_row("SELECT id FROM tags WHERE name = ?1", params![tag_name], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?1, ?2)",
            params![song_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(true)
}

// Groups live songs whose titles match after trimming and case-folding.
// Within a group, equal content hashes mean word-for-word identical copies.
pub fn find_duplicates() -> Result<Vec<DuplicateGroup>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT s.id, s.title, s.author, s.song_number,
                   COUNT(v.id) as verse_count,
                   LOWER(TRIM(s.title)) as norm_title
            FROM songs s
            LEFT JOIN verses v ON s.id = v.song_id
            WHERE s.deleted_at IS NULL
              AND LOWER(TRIM(s.title)) IN (
                SELECT LOWER(TRIM(title)) FROM songs
                WHERE deleted_at IS NULL
                GROUP BY LOWER(TRIM(title))
                HAVING COUNT(*) > 1
              )
            GROUP BY s.id
            ORDER BY norm_title, s.id
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(i64, String, Option<String>, Option<String>, i32, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut vstmt = conn
        .prepare("SELECT text FROM verses WHERE song_id = ?1 ORDER BY position")
        .map_err(|e| e.to_string())?;

    let mut groups: Vec<DuplicateGroup> = Vec::new();
    let mut current_key: Option<String> = None;

    for (id, title, author, song_number, verse_count, norm_title) in rows {
        let verse_texts: Vec<String> = vstmt
            .query_map(params![id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let mut hasher = DefaultHasher::new();
        title.trim().to_lowercase().hash(&mut hasher);
        for t in &verse_texts {
            t.trim().hash(&mut hasher);
        }
        let content_hash = format!("{:016x}", hasher.finish());

        let song = DuplicateSong {
            id,
            title: title.clone(),
            author,
            song_number,
            verse_count,
            content_hash,
        };

        if current_key.as_deref() != Some(norm_title.as_str()) {
            groups.push(DuplicateGroup {
                title,
                songs: Vec::new(),
            });
            current_key = Some(norm_title);
        }
        groups.last_mut().unwrap().songs.push(song);
    }

    Ok(groups)
}

// Removes every song from the library. Verses, song_tags and setlist entries
// go via FK cascade; setlists themselves survive (emptied, not deleted). The
// FTS indexes use the 'delete-all' command because they are external-content
// tables — row-by-row DELETEs need the content rows to still be present.
//
// The AUTOINCREMENT counters are reset too: without this, a DELETE leaves
// sqlite_sequence at the old maximum, so a replaced library's ids keep climbing
// (e.g. 5293, 5294…). Since songs with no explicit number display their id as a
// fallback number, that made a fresh import show large, wrong numbers. Reset so
// a replaced library numbers cleanly from 1.
pub fn clear_all_songs() -> Result<(), String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    conn.execute_batch(
        r#"
        INSERT INTO songs_fts(songs_fts) VALUES('delete-all');
        INSERT INTO verses_fts(verses_fts) VALUES('delete-all');
        DELETE FROM songs;
        DELETE FROM tags;
        DELETE FROM sqlite_sequence WHERE name IN ('songs', 'verses', 'tags');
        "#,
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_util::setup_temp_db;

    fn make_song(title: &str, number: Option<&str>, verse_texts: &[&str]) -> Song {
        Song {
            id: None,
            title: title.to_string(),
            author: None,
            musical_key: None,
            song_number: number.map(|n| n.to_string()),
            source: None,
            verses: verse_texts
                .iter()
                .enumerate()
                .map(|(i, t)| Verse {
                    id: None,
                    label: format!("Verse {}", i + 1),
                    text: t.to_string(),
                    position: None,
                })
                .collect(),
            tags: Vec::new(),
        }
    }

    #[test]
    fn clear_all_songs_resets_id_counter() {
        let _db = setup_temp_db();

        // Seed several songs so the auto-increment counter climbs…
        for i in 0..5 {
            create_song(&make_song(&format!("Song {}", i), None, &["line"])).unwrap();
        }
        let last = create_song(&make_song("Last", None, &["line"])).unwrap();
        assert!(last >= 6);

        // …then a full wipe (as replace-library does) must restart ids at 1,
        // so numberless songs display 1, 2, 3… rather than continuing to climb.
        clear_all_songs().unwrap();
        let fresh = create_song(&make_song("Fresh Start", None, &["line"])).unwrap();
        assert_eq!(fresh, 1);
    }

    #[test]
    fn soft_delete_hides_restores_and_purges() {
        let _db = setup_temp_db();

        let id = create_song(&make_song("Abide With Me", Some("27"), &["fast falls the eventide"]))
            .expect("create");

        assert!(delete_song(id).expect("delete"));
        // Gone from every read path…
        assert!(get_all_songs("title").unwrap().is_empty());
        assert!(get_song(id).unwrap().is_none());
        assert!(search_songs("eventide", "title").unwrap().is_empty());
        assert!(find_song_id_by_number("27").unwrap().is_none());
        // …but visible in the trash.
        let trash = list_deleted_songs().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].title, "Abide With Me");

        // Deleting again is a no-op.
        assert!(!delete_song(id).expect("double delete"));

        assert!(restore_song(id).expect("restore"));
        assert_eq!(get_all_songs("title").unwrap().len(), 1);
        assert_eq!(search_songs("eventide", "title").unwrap().len(), 1);
        assert_eq!(find_song_id_by_number("27").unwrap(), Some(id));
        assert!(list_deleted_songs().unwrap().is_empty());

        // Purge only removes entries past the age threshold.
        assert!(delete_song(id).expect("delete again"));
        assert_eq!(purge_expired_deleted(30).expect("purge fresh"), 0);
        assert_eq!(list_deleted_songs().unwrap().len(), 1);
        // Backdate the deletion past the threshold and purge again.
        {
            let conn = get_connection().unwrap();
            conn.execute(
                "UPDATE songs SET deleted_at = datetime('now', '-40 days') WHERE id = ?1",
                params![id],
            )
            .unwrap();
        }
        assert_eq!(purge_expired_deleted(30).expect("purge old"), 1);
        assert!(list_deleted_songs().unwrap().is_empty());
        assert!(!restore_song(id).expect("restore purged"));
    }

    #[test]
    fn duplicate_finder_groups_by_title_and_flags_identical_copies() {
        let _db = setup_temp_db();

        let a = create_song(&make_song("Amazing Grace", None, &["how sweet the sound"])).unwrap();
        let b = create_song(&make_song("amazing grace ", None, &["how sweet the sound"])).unwrap();
        let c = create_song(&make_song("Amazing Grace", None, &["different words entirely"])).unwrap();
        create_song(&make_song("Just As I Am", None, &["without one plea"])).unwrap();

        let groups = find_duplicates().expect("find duplicates");
        assert_eq!(groups.len(), 1);
        let group = &groups[0];
        assert_eq!(group.songs.len(), 3);

        let hash_of = |id: i64| {
            group
                .songs
                .iter()
                .find(|s| s.id == id)
                .map(|s| s.content_hash.clone())
                .expect("song in group")
        };
        assert_eq!(hash_of(a), hash_of(b));
        assert_ne!(hash_of(a), hash_of(c));

        // Trashed songs never appear as duplicates.
        delete_song(b).unwrap();
        delete_song(c).unwrap();
        assert!(find_duplicates().unwrap().is_empty());
    }
}

// Soft delete: the song is stamped deleted_at and drops out of every read
// path, but the row (and its verses, tags and setlist entries) survive so a
// restore brings everything back. Hard removal happens via purge or
// clear_all_songs.
pub fn delete_song(song_id: i64) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    // Bail out unless the song exists and is live: deleting an FTS entry
    // twice corrupts an external-content FTS5 index ("malformed" errors).
    let live: Result<bool, _> = conn.query_row(
        "SELECT deleted_at IS NULL FROM songs WHERE id = ?1",
        params![song_id],
        |row| row.get(0),
    );
    match live {
        Ok(true) => {}
        Ok(false) => return Ok(false),
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(false),
        Err(e) => return Err(e.to_string()),
    }

    // Take it out of search immediately — the FTS rows are recreated on restore.
    conn.execute("DELETE FROM songs_fts WHERE rowid = ?1", params![song_id])
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id FROM verses WHERE song_id = ?1")
        .map_err(|e| e.to_string())?;
    let verse_ids: Vec<i64> = stmt
        .query_map(params![song_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for vid in verse_ids {
        conn.execute("DELETE FROM verses_fts WHERE rowid = ?1", params![vid])
            .map_err(|e| e.to_string())?;
    }

    let rows_updated = conn
        .execute(
            "UPDATE songs SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?1 AND deleted_at IS NULL",
            params![song_id],
        )
        .map_err(|e| e.to_string())?;

    Ok(rows_updated > 0)
}

pub fn restore_song(song_id: i64) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let rows_updated = conn
        .execute(
            "UPDATE songs SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![song_id],
        )
        .map_err(|e| e.to_string())?;
    if rows_updated == 0 {
        return Ok(false);
    }

    // Rebuild the FTS rows removed at delete time.
    conn.execute(
        "INSERT INTO songs_fts (rowid, title, author)
         SELECT id, title, COALESCE(author, '') FROM songs WHERE id = ?1",
        params![song_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO verses_fts (rowid, text)
         SELECT id, text FROM verses WHERE song_id = ?1",
        params![song_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(true)
}

pub fn list_deleted_songs() -> Result<Vec<DeletedSongSummary>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, author, deleted_at FROM songs
             WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let songs: Vec<DeletedSongSummary> = stmt
        .query_map([], |row| {
            Ok(DeletedSongSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                deleted_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(songs)
}

// Hard-deletes songs trashed more than `days` days ago. Their FTS rows were
// already removed at soft-delete time; verses/tags/setlist entries cascade.
pub fn purge_expired_deleted(days: i64) -> Result<usize, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM songs WHERE deleted_at IS NOT NULL
         AND deleted_at < datetime('now', ?1)",
        params![format!("-{} days", days)],
    )
    .map_err(|e| e.to_string())
}
