use crate::db::get_connection;
use crate::models::{Collection, CollectionEntry, CollectionSummary};
use rusqlite::params;

pub fn get_all_collections() -> Result<Vec<CollectionSummary>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT sl.id, sl.name,
                   COALESCE(SUM(
                       CASE WHEN ss.id IS NOT NULL
                                 AND (ss.item_type != 'song' OR s.id IS NOT NULL)
                            THEN 1 ELSE 0 END
                   ), 0) AS item_count
            FROM setlists sl
            LEFT JOIN setlist_songs ss ON ss.setlist_id = sl.id
            LEFT JOIN songs s ON s.id = ss.song_id AND s.deleted_at IS NULL
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

    // Bible/logo entries have no song row and are always shown; song entries
    // only appear while their song is live (not soft-deleted).
    let mut stmt = conn
        .prepare(
            r#"
            SELECT ss.id, ss.item_type, ss.song_id, ss.reference, ss.position,
                   s.title, s.author, s.musical_key
            FROM setlist_songs ss
            LEFT JOIN songs s ON s.id = ss.song_id AND s.deleted_at IS NULL
            WHERE ss.setlist_id = ?1
              AND (ss.item_type != 'song' OR s.id IS NOT NULL)
            ORDER BY ss.position
            "#,
        )
        .map_err(|e| e.to_string())?;

    let songs: Vec<CollectionEntry> = stmt
        .query_map(params![collection_id], |row| {
            let item_type: String = row.get(1)?;
            let reference: Option<String> = row.get(3)?;
            let song_title: Option<String> = row.get(5)?;
            // Display title depends on the entry kind.
            let title = match item_type.as_str() {
                "bible" => reference.clone().unwrap_or_default(),
                "logo" => "Logo slide".to_string(),
                _ => song_title.unwrap_or_default(),
            };
            Ok(CollectionEntry {
                id: row.get(0)?,
                item_type,
                song_id: row.get(2)?,
                reference,
                position: row.get(4)?,
                title,
                author: row.get(6)?,
                musical_key: row.get(7)?,
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

// Appends any kind of entry (song / bible / logo) to the end of a collection.
pub fn add_item_to_collection(
    collection_id: i64,
    item_type: &str,
    song_id: Option<i64>,
    reference: Option<&str>,
) -> Result<i64, String> {
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
        "INSERT INTO setlist_songs (setlist_id, song_id, item_type, reference, position)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![collection_id, song_id, item_type, reference, next_pos],
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_util::setup_temp_db;
    use crate::models::Song;
    use crate::songs::{create_song, delete_song};

    fn song(title: &str) -> Song {
        Song {
            id: None,
            title: title.to_string(),
            author: Some("Composer".to_string()),
            musical_key: Some("G".to_string()),
            song_number: None,
            source: None,
            verses: Vec::new(),
            tags: Vec::new(),
        }
    }

    #[test]
    fn mixed_collection_crud_ordering_and_soft_delete() {
        let _db = setup_temp_db();
        let sid = create_song(&song("Amazing Grace")).unwrap();
        let cid = create_collection("Sunday Morning").unwrap();

        let e_song = add_item_to_collection(cid, "song", Some(sid), None).unwrap();
        let e_bible = add_item_to_collection(cid, "bible", None, Some("John 3:16")).unwrap();
        let e_logo = add_item_to_collection(cid, "logo", None, None).unwrap();

        // All three kinds come back with the right shape and display titles.
        let c = get_collection(cid).unwrap().unwrap();
        assert_eq!(c.songs.len(), 3);
        assert_eq!(c.songs[0].item_type, "song");
        assert_eq!(c.songs[0].title, "Amazing Grace");
        assert_eq!(c.songs[0].song_id, Some(sid));
        assert_eq!(c.songs[1].item_type, "bible");
        assert_eq!(c.songs[1].title, "John 3:16");
        assert_eq!(c.songs[1].reference.as_deref(), Some("John 3:16"));
        assert_eq!(c.songs[1].song_id, None);
        assert_eq!(c.songs[2].item_type, "logo");
        assert_eq!(c.songs[2].title, "Logo slide");

        // Summary count includes every visible entry.
        let count = get_all_collections()
            .unwrap()
            .into_iter()
            .find(|s| s.id == cid)
            .unwrap()
            .song_count;
        assert_eq!(count, 3);

        // Reordering keys on entry id and works across kinds.
        reorder_collection_songs(cid, &[e_logo, e_bible, e_song]).unwrap();
        let c = get_collection(cid).unwrap().unwrap();
        assert_eq!(c.songs[0].item_type, "logo");
        assert_eq!(c.songs[2].item_type, "song");

        // Soft-deleting the song hides only the song entry; bible/logo remain.
        delete_song(sid).unwrap();
        let c = get_collection(cid).unwrap().unwrap();
        assert_eq!(c.songs.len(), 2);
        assert!(c.songs.iter().all(|e| e.item_type != "song"));
        let count = get_all_collections()
            .unwrap()
            .into_iter()
            .find(|s| s.id == cid)
            .unwrap()
            .song_count;
        assert_eq!(count, 2);

        // Removing a reference entry works.
        assert!(remove_song_from_collection(cid, e_bible).unwrap());
        let c = get_collection(cid).unwrap().unwrap();
        assert_eq!(c.songs.len(), 1);
        assert_eq!(c.songs[0].item_type, "logo");
    }
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
