use crate::db::get_connection;
use rusqlite::params;
use serde::Serialize;

#[derive(Serialize)]
struct ExportVerse {
    label: String,
    text: String,
}

#[derive(Serialize)]
struct ExportSong {
    title: String,
    author: String,
    key: String,
    verses: Vec<ExportVerse>,
}

struct SongWithVerses {
    #[allow(dead_code)]
    id: i64,
    title: String,
    author: Option<String>,
    musical_key: Option<String>,
    verses: Vec<(String, String)>,
}

fn get_all_songs_with_verses() -> Result<Vec<SongWithVerses>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, title, author, musical_key FROM songs ORDER BY title")
        .map_err(|e| e.to_string())?;

    let songs: Vec<(i64, String, Option<String>, Option<String>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::new();

    for (id, title, author, musical_key) in songs {
        let mut stmt = conn
            .prepare("SELECT label, text FROM verses WHERE song_id = ?1 ORDER BY position")
            .map_err(|e| e.to_string())?;

        let verses: Vec<(String, String)> = stmt
            .query_map(params![id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        result.push(SongWithVerses {
            id,
            title,
            author,
            musical_key,
            verses,
        });
    }

    Ok(result)
}

pub fn export_json() -> Result<String, String> {
    let songs = get_all_songs_with_verses()?;

    let export: Vec<ExportSong> = songs
        .into_iter()
        .map(|s| ExportSong {
            title: s.title,
            author: s.author.unwrap_or_default(),
            key: s.musical_key.unwrap_or_default(),
            verses: s
                .verses
                .into_iter()
                .map(|(label, text)| ExportVerse { label, text })
                .collect(),
        })
        .collect();

    serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
}

pub fn export_csv() -> Result<String, String> {
    let songs = get_all_songs_with_verses()?;

    let mut buf = Vec::new();
    {
        let mut writer = csv::Writer::from_writer(&mut buf);
        writer
            .write_record(["title", "author", "key", "verse_label", "verse_text"])
            .map_err(|e| e.to_string())?;

        for song in songs {
            if song.verses.is_empty() {
                writer
                    .write_record([
                        &song.title,
                        song.author.as_deref().unwrap_or(""),
                        song.musical_key.as_deref().unwrap_or(""),
                        "",
                        "",
                    ])
                    .map_err(|e| e.to_string())?;
            } else {
                for (label, text) in &song.verses {
                    writer
                        .write_record([
                            &song.title,
                            song.author.as_deref().unwrap_or(""),
                            song.musical_key.as_deref().unwrap_or(""),
                            label,
                            text,
                        ])
                        .map_err(|e| e.to_string())?;
                }
            }
        }

        writer.flush().map_err(|e| e.to_string())?;
    }

    String::from_utf8(buf).map_err(|e| e.to_string())
}

pub fn export_txt() -> Result<String, String> {
    let songs = get_all_songs_with_verses()?;

    let mut parts = Vec::new();

    for song in songs {
        let mut lines = vec![song.title.clone()];

        if let Some(ref author) = song.author {
            lines.push(author.clone());
        }

        if let Some(ref key) = song.musical_key {
            lines.push(format!("Key: {}", key));
        }

        lines.push(String::new());

        for (label, text) in &song.verses {
            lines.push(label.clone());
            lines.push(text.clone());
            lines.push(String::new());
        }

        parts.push(lines.join("\n"));
    }

    Ok(parts.join("\n---\n\n"))
}
