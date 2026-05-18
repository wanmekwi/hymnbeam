use serde::Serialize;
use std::collections::HashMap;

const KJV_JSON: &str = include_str!("../kjv.json");

#[derive(Serialize)]
pub struct BookInfo {
    pub code: String,
    pub name: String,
    pub chapters: usize,
}

#[derive(Serialize)]
pub struct VerseRow {
    pub verse: u32,
    pub text: String,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub id: i64,
    pub book: String,
    pub name: String,
    pub chapter: u32,
    pub verse: u32,
    pub text: String,
    pub reference: String,
}

pub fn ensure_bible_loaded(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM bible_verses", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    #[derive(serde::Deserialize)]
    struct KjvData {
        books: Vec<String>,
        names: HashMap<String, String>,
        bible: HashMap<String, HashMap<String, HashMap<String, String>>>,
    }

    let data: KjvData = serde_json::from_str(KJV_JSON).expect("kjv.json is malformed");

    let tx = conn.unchecked_transaction()?;
    let mut stmt = tx.prepare(
        "INSERT INTO bible_verses (book, name, chapter, verse, text)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;

    let mut verse_count = 0u32;
    for code in &data.books {
        let name = data.names.get(code).map(|s| s.as_str()).unwrap_or(code);
        if let Some(chapters) = data.bible.get(code) {
            let mut ch_nums: Vec<u32> = chapters.keys().filter_map(|k| k.parse().ok()).collect();
            ch_nums.sort_unstable();
            for ch in ch_nums {
                if let Some(verses) = chapters.get(&ch.to_string()) {
                    let mut v_nums: Vec<u32> = verses.keys().filter_map(|k| k.parse().ok()).collect();
                    v_nums.sort_unstable();
                    for v in v_nums {
                        if let Some(text) = verses.get(&v.to_string()) {
                            stmt.execute(rusqlite::params![code, name, ch, v, text])?;
                            verse_count += 1;
                        }
                    }
                }
            }
        }
    }
    drop(stmt);
    tx.execute_batch("INSERT INTO bible_fts(bible_fts) VALUES('rebuild');")?;
    tx.commit()?;
    println!("Bible loaded ({verse_count} verses)");
    Ok(())
}

pub fn get_books() -> rusqlite::Result<Vec<BookInfo>> {
    let conn = crate::db::get_connection()?;
    let mut stmt = conn.prepare(
        "SELECT book, name, MAX(chapter) AS chapters
         FROM bible_verses
         GROUP BY book
         ORDER BY MIN(id)",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(BookInfo {
            code: r.get(0)?,
            name: r.get(1)?,
            chapters: r.get::<_, u32>(2)? as usize,
        })
    })?;
    rows.collect()
}

pub fn get_chapter(book: &str, chapter: u32) -> rusqlite::Result<Vec<VerseRow>> {
    let conn = crate::db::get_connection()?;
    let mut stmt = conn.prepare(
        "SELECT verse, text FROM bible_verses
         WHERE book = ?1 AND chapter = ?2
         ORDER BY verse",
    )?;
    let rows = stmt.query_map(rusqlite::params![book, chapter], |r| {
        Ok(VerseRow {
            verse: r.get(0)?,
            text: r.get(1)?,
        })
    })?;
    rows.collect()
}

// Build an FTS5 query that:
// - matches ALL typed words (AND logic, not phrase)
// - prefix-matches the last token so results appear while typing
// - strips FTS5 special characters to avoid syntax errors
fn build_fts_query(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    if words.is_empty() {
        return String::new();
    }
    let trailing_space = raw.ends_with(|c: char| c.is_whitespace());
    words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            if !trailing_space && i == words.len() - 1 {
                format!("{}*", w)
            } else {
                w.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn search_bible(query: &str, limit: u32) -> rusqlite::Result<Vec<SearchHit>> {
    let fts_query = build_fts_query(query);
    if fts_query.is_empty() {
        return Ok(vec![]);
    }
    let conn = crate::db::get_connection()?;
    // Use a CTE to rank inside the FTS5 context, then join for full row data.
    // ORDER BY rank directly on a JOIN is unreliable in SQLite FTS5.
    let mut stmt = conn.prepare(
        "WITH ranked(rid, bm25) AS (
             SELECT rowid, rank FROM bible_fts
             WHERE bible_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2
         )
         SELECT bv.id, bv.book, bv.name, bv.chapter, bv.verse, bv.text
         FROM ranked
         JOIN bible_verses bv ON bv.id = ranked.rid
         ORDER BY ranked.bm25",
    )?;
    let rows = stmt.query_map(rusqlite::params![fts_query, limit], |r| {
        let name: String = r.get(2)?;
        let chapter: u32 = r.get(3)?;
        let verse: u32 = r.get(4)?;
        Ok(SearchHit {
            id: r.get(0)?,
            book: r.get(1)?,
            reference: format!("{} {}:{}", name, chapter, verse),
            name,
            chapter,
            verse,
            text: r.get(5)?,
        })
    })?;
    rows.collect()
}
