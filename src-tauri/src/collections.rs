use crate::db::get_connection;
use crate::models::{Collection, CollectionEntry, CollectionSummary};
use rusqlite::params;

pub fn get_all_collections() -> Result<Vec<CollectionSummary>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT sl.id, sl.name, COUNT(ss.id) as song_count
            FROM setlists sl
            LEFT JOIN setlist_songs ss ON ss.setlist_id = sl.id
            GROUP BY sl.id
            ORDER BY sl.created_at DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let collections: Vec<CollectionSummary> = stmt
        .query_map([], |row| {
            Ok(CollectionSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                song_count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(collections)
}

pub fn get_collection(collection_id: i64) -> Result<Option<Collection>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let name_result: Result<String, _> = conn.query_row(
        "SELECT name FROM setlists WHERE id = ?1",
        params![collection_id],
        |row| row.get(0),
    );

    let name = match name_result {
        Ok(n) => n,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };

    let mut stmt = conn
        .prepare(
            r#"
            SELECT ss.id, ss.song_id, ss.position, s.title, s.author, s.musical_key
            FROM setlist_songs ss
            JOIN songs s ON s.id = ss.song_id
            WHERE ss.setlist_id = ?1
            ORDER BY ss.position
            "#,
        )
        .map_err(|e| e.to_string())?;

    let songs: Vec<CollectionEntry> = stmt
        .query_map(params![collection_id], |row| {
            Ok(CollectionEntry {
                id: row.get(0)?,
                song_id: row.get(1)?,
                position: row.get(2)?,
                title: row.get(3)?,
                author: row.get(4)?,
                musical_key: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Some(Collection {
        id: Some(collection_id),
        name,
        songs,
    }))
}

pub fn create_collection(name: &str) -> Result<i64, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    conn.execute("INSERT INTO setlists (name) VALUES (?1)", params![name])
        .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn rename_collection(collection_id: i64, name: &str) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let rows_updated = conn
        .execute(
            "UPDATE setlists SET name = ?1 WHERE id = ?2",
            params![name, collection_id],
        )
        .map_err(|e| e.to_string())?;

    Ok(rows_updated > 0)
}

pub fn delete_collection(collection_id: i64) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let rows_deleted = conn
        .execute("DELETE FROM setlists WHERE id = ?1", params![collection_id])
        .map_err(|e| e.to_string())?;

    Ok(rows_deleted > 0)
}

pub fn add_song_to_collection(collection_id: i64, song_id: i64) -> Result<i64, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let max_pos: Option<i32> = conn
        .query_row(
            "SELECT MAX(position) FROM setlist_songs WHERE setlist_id = ?1",
            params![collection_id],
            |row| row.get(0),
        )
        .unwrap_or(None);

    let next_pos = max_pos.unwrap_or(0) + 1;

    conn.execute(
        "INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES (?1, ?2, ?3)",
        params![collection_id, song_id, next_pos],
    )
    .map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

pub fn remove_song_from_collection(collection_id: i64, entry_id: i64) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let rows_deleted = conn
        .execute(
            "DELETE FROM setlist_songs WHERE id = ?1 AND setlist_id = ?2",
            params![entry_id, collection_id],
        )
        .map_err(|e| e.to_string())?;

    if rows_deleted > 0 {
        let mut stmt = conn
            .prepare("SELECT id FROM setlist_songs WHERE setlist_id = ?1 ORDER BY position")
            .map_err(|e| e.to_string())?;

        let ids: Vec<i64> = stmt
            .query_map(params![collection_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        for (i, id) in ids.iter().enumerate() {
            conn.execute(
                "UPDATE setlist_songs SET position = ?1 WHERE id = ?2",
                params![(i + 1) as i32, id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(rows_deleted > 0)
}

pub fn reorder_collection_songs(collection_id: i64, ordered_entry_ids: &[i64]) -> Result<bool, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    for (i, entry_id) in ordered_entry_ids.iter().enumerate() {
        conn.execute(
            "UPDATE setlist_songs SET position = ?1 WHERE id = ?2 AND setlist_id = ?3",
            params![(1000 + i) as i32, entry_id, collection_id],
        )
        .map_err(|e| e.to_string())?;
    }

    for (i, entry_id) in ordered_entry_ids.iter().enumerate() {
        conn.execute(
            "UPDATE setlist_songs SET position = ?1 WHERE id = ?2 AND setlist_id = ?3",
            params![(i + 1) as i32, entry_id, collection_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(true)
}
