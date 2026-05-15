use crate::db::get_connection;
use crate::models::{Song, SongSummary, Verse};
use rusqlite::params;

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

pub fn create_song(song: &Song) -> Result<i64, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO songs (title, author, musical_key, song_number) VALUES (?1, ?2, ?3, ?4)",
        params![song.title, song.author, song.musical_key, song.song_number],
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

    let song_result: Result<(String, Option<String>, Option<String>, Option<String>), _> =
        conn.query_row(
            "SELECT title, author, musical_key, song_number FROM songs WHERE id = ?1",
            params![song_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        );

    let (title, author, musical_key, song_number) = match song_result {
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
        verses,
        tags,
    }))
}

pub fn get_all_songs(sort_by: &str) -> Result<Vec<SongSummary>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let order_clause = get_sort_clause(sort_by);

    let query = format!(
        r#"
        SELECT s.id, s.title, s.author, s.musical_key, s.song_number, COUNT(v.id) as verse_count
        FROM songs s
        LEFT JOIN verses v ON s.id = v.song_id
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
                verse_count: row.get(5)?,
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
        SELECT DISTINCT s.id, s.title, s.author, s.musical_key, s.song_number, COUNT(v.id) as verse_count
        FROM songs s
        LEFT JOIN verses v ON s.id = v.song_id
        WHERE s.id IN (
            SELECT rowid FROM songs_fts WHERE songs_fts MATCH ?1
        ) OR s.id IN (
            SELECT song_id FROM verses WHERE id IN (
                SELECT rowid FROM verses_fts WHERE verses_fts MATCH ?1
            )
        )
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
                verse_count: row.get(5)?,
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
        SELECT DISTINCT s.id, s.title, s.author, s.musical_key, s.song_number, COUNT(v.id) as verse_count
        FROM songs s
        LEFT JOIN verses v ON s.id = v.song_id
        WHERE s.title LIKE ?1 COLLATE NOCASE
           OR s.author LIKE ?1 COLLATE NOCASE
           OR s.musical_key LIKE ?1 COLLATE NOCASE
           OR s.song_number LIKE ?1
           OR CAST(s.id AS TEXT) LIKE ?1
           OR EXISTS (SELECT 1 FROM verses v2 WHERE v2.song_id = s.id AND v2.text LIKE ?1 COLLATE NOCASE)
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
                verse_count: row.get(5)?,
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
            "UPDATE songs SET title = ?1, author = ?2, musical_key = ?3, song_number = ?4, updated_at = CURRENT_TIMESTAMP WHERE id = ?5",
            params![song.title, song.author, song.musical_key, song.song_number, song_id],
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

pub fn delete_song(song_id: i64) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

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

    let rows_deleted = conn
        .execute("DELETE FROM songs WHERE id = ?1", params![song_id])
        .map_err(|e| e.to_string())?;

    Ok(rows_deleted > 0)
}
