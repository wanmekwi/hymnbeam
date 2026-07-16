use crate::db::get_connection;
use crate::models::{ImportedHymn, Song, Verse};
use crate::songs::create_song;
use regex::Regex;
use rusqlite::params;
use std::collections::HashMap;
use std::path::Path;

// Fingerprint = title + each verse's text, joined by NUL. NUL can't appear in
// SQLite TEXT values, so collisions only happen on genuinely identical songs.
fn fingerprint(title: &str, verses: &[Verse]) -> String {
    let mut fp = String::with_capacity(title.len() + 64);
    fp.push_str(title.trim());
    for v in verses {
        fp.push('\0');
        fp.push_str(v.text.trim());
    }
    fp
}

// Returns the id of an existing song whose (title, verse-texts) fingerprint
// matches `song`, so re-imports of the same file don't duplicate rows.
fn find_existing_song_id(song: &Song) -> Result<Option<i64>, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let target = fingerprint(&song.title, &song.verses);

    // Trashed songs don't count as duplicates — otherwise a re-import would
    // silently "succeed" by pointing at a song the user just deleted.
    let mut stmt = conn
        .prepare("SELECT id FROM songs WHERE title = ?1 AND deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    let candidate_ids: Vec<i64> = stmt
        .query_map(params![song.title], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for sid in candidate_ids {
        let mut vstmt = conn
            .prepare("SELECT label, text FROM verses WHERE song_id = ?1 ORDER BY position")
            .map_err(|e| e.to_string())?;
        let existing_verses: Vec<Verse> = vstmt
            .query_map(params![sid], |row| {
                Ok(Verse {
                    id: None,
                    label: row.get(0)?,
                    text: row.get(1)?,
                    position: None,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        if fingerprint(&song.title, &existing_verses) == target {
            return Ok(Some(sid));
        }
    }
    Ok(None)
}

fn parse_lyrics_to_verses(lyrics: &str) -> Vec<Verse> {
    if lyrics.trim().is_empty() {
        return Vec::new();
    }

    let section_pattern = Regex::new(
        r"(?i)^(Verse\s*\d*|Chorus|Bridge|Intro|Outro|Pre-Chorus|Pre Chorus|Tag|Refrain|Coda|Verse\d+)\s*$",
    )
    .unwrap();

    // Split on blank lines, tolerating stray whitespace and \r\n endings
    // (mirrors Python's re.split(r'\n\s*\n+', ...)).
    let normalized = lyrics.replace("\r\n", "\n").replace('\r', "\n");
    let para_split = Regex::new(r"\n\s*\n+").unwrap();
    let paragraphs: Vec<&str> = para_split
        .split(normalized.trim())
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect();

    let mut verses = Vec::new();
    let mut verse_counter = 1;

    for para in paragraphs {
        let lines: Vec<&str> = para.lines().collect();
        if lines.is_empty() {
            continue;
        }

        let first_line = lines[0].trim();

        if section_pattern.is_match(first_line) {
            let mut label = first_line.to_string();
            let re_digits = Regex::new(r"(\d+)").unwrap();
            label = re_digits.replace(&label, " $1").trim().to_string();

            let words: Vec<&str> = label.split_whitespace().collect();
            label = words
                .iter()
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + c.as_str().to_lowercase().as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");

            let text: String = lines[1..]
                .iter()
                .map(|l| l.trim())
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();

            if !text.is_empty() {
                verses.push(Verse {
                    id: None,
                    label,
                    text,
                    position: None,
                });
            }
        } else {
            let text: String = lines
                .iter()
                .map(|l| l.trim())
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();

            if !text.is_empty() {
                let text_lower = text.to_lowercase();
                let existing_label = verses
                    .iter()
                    .find(|v| v.text.to_lowercase() == text_lower)
                    .map(|v| v.label.clone());

                let label = existing_label.unwrap_or_else(|| {
                    let l = format!("Verse {}", verse_counter);
                    verse_counter += 1;
                    l
                });

                verses.push(Verse {
                    id: None,
                    label,
                    text,
                    position: None,
                });
            }
        }
    }

    verses
}

fn parse_json(content: &str) -> Result<Vec<Song>, String> {
    let data: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;

    if let Some(arr) = data.as_array() {
        let mut songs = Vec::new();
        for item in arr {
            let hymn: ImportedHymn = match serde_json::from_value(item.clone()) {
                Ok(h) => h,
                Err(_) => continue,
            };
            if hymn.title.trim().is_empty() {
                continue;
            }
            songs.push(hymn_to_song(&hymn));
        }
        Ok(songs)
    } else {
        let hymn: ImportedHymn = serde_json::from_value(data).map_err(|e| e.to_string())?;
        Ok(vec![hymn_to_song(&hymn)])
    }
}

fn hymn_to_song(hymn: &ImportedHymn) -> Song {
    let verses = if let Some(ref v) = hymn.verses {
        v.iter()
            .enumerate()
            .map(|(i, verse)| Verse {
                id: None,
                label: verse
                    .label
                    .clone()
                    .unwrap_or_else(|| format!("Verse {}", i + 1)),
                text: verse.text.clone(),
                position: None,
            })
            .collect()
    } else if let Some(ref lyrics) = hymn.lyrics {
        parse_lyrics_to_verses(lyrics)
    } else {
        Vec::new()
    };

    let tags = hymn.tags.clone().unwrap_or_default();

    Song {
        id: None,
        title: hymn.title.clone(),
        author: hymn.author.clone().filter(|a| !a.is_empty()),
        musical_key: hymn.musical_key.clone().filter(|k| !k.is_empty()),
        song_number: hymn.song_number.clone().filter(|n| !n.is_empty()),
        source: hymn.source.clone().filter(|s| !s.trim().is_empty()),
        verses,
        tags,
    }
}

fn parse_csv(content: &str) -> Result<Vec<Song>, String> {
    let mut reader = csv::Reader::from_reader(content.as_bytes());

    // Resolve columns by header name so any column order is accepted.
    let headers = reader.headers().map_err(|e| e.to_string())?.clone();
    let col = |names: &[&str]| {
        names.iter().find_map(|name| {
            headers.iter().position(|h| h.trim().eq_ignore_ascii_case(name))
        })
    };
    let title_idx = col(&["title"]).ok_or("CSV missing required 'title' column")?;
    let author_idx = col(&["author"]);
    let number_idx = col(&["number", "song_number", "songnumber", "no"]);
    let key_idx = col(&["key", "musical_key", "musicalkey"]);
    let label_idx = col(&["verse_label"]);
    let text_idx = col(&["verse_text"]);

    // Preserve the order songs first appear in the file.
    let mut order: Vec<String> = Vec::new();
    type SongData = (Option<String>, Option<String>, Option<String>, Vec<(String, String)>);
    let mut songs_data: HashMap<String, SongData> = HashMap::new();

    for result in reader.records() {
        let record = result.map_err(|e| e.to_string())?;

        let title = record.get(title_idx).unwrap_or("").trim().to_string();
        if title.is_empty() {
            continue;
        }

        let field = |idx: Option<usize>| {
            idx.and_then(|i| record.get(i))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let author = field(author_idx);
        let number = field(number_idx);
        let key = field(key_idx);
        let verse_label = label_idx.and_then(|i| record.get(i)).unwrap_or("").to_string();
        let verse_text = text_idx.and_then(|i| record.get(i)).unwrap_or("").to_string();

        let entry = songs_data.entry(title.clone()).or_insert_with(|| {
            order.push(title.clone());
            (author, number, key, Vec::new())
        });
        if !verse_text.is_empty() {
            let label = if verse_label.is_empty() {
                format!("Verse {}", entry.3.len() + 1)
            } else {
                verse_label
            };
            entry.3.push((label, verse_text));
        }
    }

    let mut songs = Vec::new();

    for title in order {
        let (author, number, key, verses_data) = songs_data.remove(&title).unwrap();
        let verses: Vec<Verse> = verses_data
            .into_iter()
            .map(|(label, text)| Verse {
                id: None,
                label,
                text,
                position: None,
            })
            .collect();

        songs.push(Song {
            id: None,
            title,
            author,
            musical_key: key,
            song_number: number,
            source: None,
            verses,
            tags: Vec::new(),
        });
    }

    Ok(songs)
}

fn parse_text(content: &str) -> Result<Song, String> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return Err("Empty file".to_string());
    }

    let title = lines[0].trim().to_string();
    let author = if lines.len() > 1 && !lines[1].trim().is_empty() {
        Some(lines[1].trim().to_string())
    } else {
        None
    };

    let verse_pattern = Regex::new(r"^\[(.+?)\]$").unwrap();
    let mut verses = Vec::new();
    let mut current_label: Option<String> = None;
    let mut current_text_lines: Vec<String> = Vec::new();

    let start_line = if author.is_some() { 2 } else { 1 };

    for line in lines.iter().skip(start_line) {
        let line = line.trim();

        if let Some(caps) = verse_pattern.captures(line) {
            if let Some(label) = current_label.take() {
                let text = current_text_lines.join("\n").trim().to_string();
                if !text.is_empty() {
                    verses.push(Verse {
                        id: None,
                        label,
                        text,
                        position: None,
                    });
                }
            }
            current_label = Some(caps[1].to_string());
            current_text_lines.clear();
        } else if current_label.is_some() {
            current_text_lines.push(line.to_string());
        } else if !line.is_empty() {
            if current_label.is_none() {
                current_label = Some(format!("Verse {}", verses.len() + 1));
            }
            current_text_lines.push(line.to_string());
        }
    }

    if let Some(label) = current_label {
        let text = current_text_lines.join("\n").trim().to_string();
        if !text.is_empty() {
            verses.push(Verse {
                id: None,
                label,
                text,
                position: None,
            });
        }
    }

    Ok(Song {
        id: None,
        title,
        author,
        musical_key: None,
        song_number: None,
        source: None,
        verses,
        tags: Vec::new(),
    })
}

fn parse_file(content: &str, filename: &str) -> Result<Vec<Song>, String> {
    // Windows editors often prepend a UTF-8 BOM, which serde_json and the
    // CSV header lookup both choke on.
    let content = content.trim_start_matches('\u{feff}');

    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "json" => parse_json(content),
        "csv" => parse_csv(content),
        "txt" | "text" => parse_text(content).map(|song| vec![song]),
        _ => Err(format!("Unsupported file type: {}", ext)),
    }
}

// Parse a database file's contents into songs without inserting anything. The
// "open another database" flow uses this to preview a file the user hasn't
// committed to, so they can browse it and cherry-pick which songs to import.
pub fn parse_songs(content: &str, filename: &str) -> Result<Vec<Song>, String> {
    parse_file(content, filename)
}

// Insert each song, skipping any whose (title, verse-texts) fingerprint already
// matches a live song so re-imports never duplicate rows. Shared by the
// whole-file import and the cherry-pick "import selected" flow.
pub fn import_songs(songs: &[Song]) -> Result<Vec<i64>, String> {
    let mut song_ids = Vec::new();
    for song in songs {
        if let Some(existing_id) = find_existing_song_id(song)? {
            song_ids.push(existing_id);
            continue;
        }
        match create_song(song) {
            Ok(id) => song_ids.push(id),
            Err(e) => eprintln!("Error importing '{}': {}", song.title, e),
        }
    }
    Ok(song_ids)
}

pub fn import_file(content: &str, filename: &str) -> Result<Vec<i64>, String> {
    let songs = parse_file(content, filename)?;
    import_songs(&songs)
}

// Cherry-pick import: adds a chosen set of songs to the existing library.
// Unlike a whole-file import it renumbers each genuinely-new song to the next
// number at the end of the library (so it never collides with what's already
// there) and tags it with `source`. Songs that already exist (same title and
// verses) are skipped and keep their current number and source.
//
// `source` — a provenance label typed by the operator. When blank, a song's
// own parsed source (e.g. from a HymnBeam export) is preserved instead.
pub fn import_selected(songs: &[Song], source: Option<&str>) -> Result<Vec<i64>, String> {
    let source = source.map(str::trim).filter(|s| !s.is_empty());
    let mut next = crate::songs::next_song_number()?;

    let mut song_ids = Vec::new();
    for song in songs {
        if let Some(existing_id) = find_existing_song_id(song)? {
            song_ids.push(existing_id);
            continue;
        }
        let mut to_create = song.clone();
        to_create.song_number = Some(next.to_string());
        next += 1;
        if let Some(src) = source {
            to_create.source = Some(src.to_string());
        }
        match create_song(&to_create) {
            Ok(id) => song_ids.push(id),
            Err(e) => eprintln!("Error importing '{}': {}", to_create.title, e),
        }
    }
    Ok(song_ids)
}

// Wipes the current library and imports `content` in its place. The file is
// parsed up front so a malformed or empty file can never destroy existing
// data — the wipe only happens once at least one song has parsed.
pub fn replace_library(content: &str, filename: &str) -> Result<Vec<i64>, String> {
    let songs = parse_file(content, filename)?;
    if songs.is_empty() {
        return Err("No songs found in file — existing library left untouched".to_string());
    }

    // Snapshot the outgoing library so a replace is always recoverable.
    crate::backup::create_backup("pre-replace")?;

    crate::songs::clear_all_songs()?;

    let mut song_ids = Vec::new();
    for song in &songs {
        match create_song(song) {
            Ok(id) => song_ids.push(id),
            Err(e) => eprintln!("Error importing '{}': {}", song.title, e),
        }
    }

    Ok(song_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_util::setup_temp_db;

    #[test]
    fn imports_json_with_utf8_bom() {
        let _db = setup_temp_db();

        let json = "\u{feff}[{\"title\": \"Amazing Grace\", \"lyrics\": \"Amazing grace how sweet the sound\\n\\nThat saved a wretch like me\"}]";
        let ids = import_file(json, "songs.json").expect("BOM-prefixed JSON should import");
        assert_eq!(ids.len(), 1);

        // Windows line endings in a plain JSON import.
        let json_crlf = "{\"title\": \"It Is Well\", \"lyrics\": \"When peace like a river\\r\\n\\r\\nAttendeth my way\"}";
        let ids = import_file(json_crlf, "song.json").expect("CRLF JSON should import");
        assert_eq!(ids.len(), 1);
    }

    #[test]
    fn imports_json_number_and_key_field_aliases() {
        let _db = setup_temp_db();

        // The BCF song databases (and many exporters) use "number" and "key"
        // rather than "songNumber"/"musicalKey". Both must be picked up.
        let json = r#"[{"number": "202", "key": "G", "title": "Amazing Grace", "lyrics": "how sweet the sound"}]"#;
        let ids = import_file(json, "library.json").expect("import");
        assert_eq!(ids.len(), 1);

        let song = crate::songs::get_song(ids[0]).unwrap().unwrap();
        assert_eq!(song.song_number.as_deref(), Some("202"));
        assert_eq!(song.musical_key.as_deref(), Some("G"));

        // A numeric (non-string) number is normalised to a string too.
        let json_num = r#"{"number": 27, "title": "Abide With Me", "lyrics": "fast falls the eventide"}"#;
        let ids = import_file(json_num, "one.json").expect("import numeric number");
        let song = crate::songs::get_song(ids[0]).unwrap().unwrap();
        assert_eq!(song.song_number.as_deref(), Some("27"));
    }

    #[test]
    fn parse_songs_previews_without_inserting_then_imports_selection() {
        let _db = setup_temp_db();

        let json = r#"[
            {"number": "1", "title": "First", "lyrics": "one"},
            {"number": "2", "title": "Second", "lyrics": "two"},
            {"number": "3", "title": "Third", "lyrics": "three"}
        ]"#;

        // Previewing must parse every song but leave the library untouched.
        let previewed = parse_songs(json, "other.json").expect("preview");
        assert_eq!(previewed.len(), 3);
        assert!(crate::songs::get_all_songs("title").expect("list").is_empty());

        // Import only a chosen subset.
        let chosen: Vec<Song> = vec![previewed[0].clone(), previewed[2].clone()];
        let ids = import_songs(&chosen).expect("import selection");
        assert_eq!(ids.len(), 2);

        let titles: Vec<String> = crate::songs::get_all_songs("title")
            .expect("list")
            .into_iter()
            .map(|s| s.title)
            .collect();
        assert_eq!(titles, vec!["First".to_string(), "Third".to_string()]);

        // Re-importing an already-present song dedupes onto the existing row
        // rather than creating a duplicate.
        let ids_again = import_songs(&[previewed[0].clone()]).expect("re-import");
        assert_eq!(ids_again, vec![ids[0]]);
        assert_eq!(crate::songs::get_all_songs("title").expect("list").len(), 2);
    }

    #[test]
    fn import_selected_renumbers_new_songs_and_tags_source() {
        let _db = setup_temp_db();

        // Seed a library whose numbers top out at 480.
        import_file(
            r#"[{"number": "480", "title": "Existing", "lyrics": "here already"}]"#,
            "seed.json",
        )
        .expect("seed");

        // Cherry-pick two songs whose file numbers (1, 2) would collide with the
        // low end of a real library. They must be appended as 481, 482 instead,
        // and tagged with the typed source.
        let incoming = parse_songs(
            r#"[
                {"number": "1", "title": "Alpha", "lyrics": "a"},
                {"number": "2", "title": "Beta", "lyrics": "b"}
            ]"#,
            "other.json",
        )
        .expect("parse");
        let ids = import_selected(&incoming, Some("BCF Scotland")).expect("import selected");
        assert_eq!(ids.len(), 2);

        let alpha = crate::songs::get_song(ids[0]).unwrap().unwrap();
        let beta = crate::songs::get_song(ids[1]).unwrap().unwrap();
        assert_eq!(alpha.song_number.as_deref(), Some("481"));
        assert_eq!(beta.song_number.as_deref(), Some("482"));
        assert_eq!(alpha.source.as_deref(), Some("BCF Scotland"));
        assert_eq!(beta.source.as_deref(), Some("BCF Scotland"));

        // A second source keeps appending — merging never collides.
        let more = parse_songs(r#"[{"title": "Gamma", "lyrics": "g"}]"#, "more.json").expect("parse");
        let ids2 = import_selected(&more, Some("Mission Praise")).expect("second source");
        let gamma = crate::songs::get_song(ids2[0]).unwrap().unwrap();
        assert_eq!(gamma.song_number.as_deref(), Some("483"));
        assert_eq!(gamma.source.as_deref(), Some("Mission Praise"));

        // A blank source keeps a song's own parsed source rather than clearing it.
        let exported = parse_songs(
            r#"[{"title": "Delta", "lyrics": "d", "source": "From File"}]"#,
            "exp.json",
        )
        .expect("parse");
        let ids3 = import_selected(&exported, Some("   ")).expect("blank source");
        let delta = crate::songs::get_song(ids3[0]).unwrap().unwrap();
        assert_eq!(delta.source.as_deref(), Some("From File"));

        // Re-selecting an existing song dedupes and leaves its number untouched.
        let dup = import_selected(&incoming, Some("Ignored")).expect("dup");
        assert_eq!(dup, ids);
        assert_eq!(crate::songs::get_song(ids[0]).unwrap().unwrap().source.as_deref(), Some("BCF Scotland"));
    }

    #[test]
    fn set_source_batch_tags_untagged_or_all() {
        let _db = setup_temp_db();
        import_file(
            r#"[{"title": "One", "lyrics": "x"}, {"title": "Two", "lyrics": "y"}]"#,
            "seed.json",
        )
        .expect("seed");

        // Tag everything untagged.
        let n = crate::songs::set_source(Some("BCF Scotland"), true).expect("batch");
        assert_eq!(n, 2);

        // Re-running only-untagged now touches nothing.
        let n2 = crate::songs::set_source(Some("Other"), true).expect("batch2");
        assert_eq!(n2, 0);

        // Overwriting all replaces regardless of existing value.
        let n3 = crate::songs::set_source(Some("Everywhere"), false).expect("batch3");
        assert_eq!(n3, 2);
        for s in crate::songs::get_all_songs("title").unwrap() {
            assert_eq!(s.source.as_deref(), Some("Everywhere"));
        }
    }

    #[test]
    fn replace_library_swaps_songs_but_never_wipes_on_bad_input() {
        let _db = setup_temp_db();

        let old = "[{\"title\": \"Old Song\", \"lyrics\": \"the former words\"}]";
        import_file(old, "old.json").expect("seed import");

        // A file that fails to parse, or parses to nothing, must leave the
        // existing library untouched.
        assert!(replace_library("not json at all", "broken.json").is_err());
        assert!(replace_library("[]", "empty.json").is_err());
        assert!(replace_library("data", "songs.xyz").is_err());
        let songs = crate::songs::get_all_songs("title").expect("list songs");
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].title, "Old Song");

        let new = "[\
            {\"title\": \"New Dawn\", \"lyrics\": \"fresh words\"},\
            {\"title\": \"Second Hymn\", \"lyrics\": \"more words\"}\
        ]";
        let ids = replace_library(new, "new.json").expect("replace should succeed");
        assert_eq!(ids.len(), 2);

        let songs = crate::songs::get_all_songs("title").expect("list songs");
        let titles: Vec<&str> = songs.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["New Dawn", "Second Hymn"]);

        // Search must only find the new library — the FTS indexes were reset.
        assert!(crate::songs::search_songs("former", "title").expect("search").is_empty());
        assert_eq!(crate::songs::search_songs("fresh", "title").expect("search").len(), 1);
    }
}
