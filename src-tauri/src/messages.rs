// The message library: a separate SQLite file of sermon text with full-text
// indexes, built outside this repository and imported by the operator. The app
// ships no text of its own; until a library is imported, every query reports
// "not installed".
//
// The library is kept apart from songs.db so song backups stay small, a backup
// restore never touches it, and searches never hold the song database lock. It
// is opened read-only, on first use.

use once_cell::sync::OnceCell;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::fmt;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// `PRAGMA application_id` of a message library: "HBML".
pub const APPLICATION_ID: i64 = 0x4842_4D4C;
/// `PRAGMA user_version` (and `meta.format_version`) this build understands.
pub const FORMAT_VERSION: i64 = 1;
const FILE_NAME: &str = "messages.db";
const IMPORTING_NAME: &str = "messages.db.importing";

/// Search snippets mark matched words with these two private-use characters.
/// The text itself contains square brackets (editorial notes), so ordinary
/// punctuation can't be used; the front end swaps these for highlighting.
pub const MATCH_START: &str = "\u{E000}";
pub const MATCH_END: &str = "\u{E001}";

pub const DEFAULT_SEARCH_LIMIT: u32 = 20;
pub const MAX_SEARCH_LIMIT: u32 = 100;

#[derive(Debug)]
pub enum LibraryError {
    NotInstalled,
    NotFound,
    /// The chosen file isn't a message library this build can use. The text is
    /// shown to the operator.
    Invalid(String),
    Sql(rusqlite::Error),
    Io(std::io::Error),
}

impl fmt::Display for LibraryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LibraryError::NotInstalled => write!(f, "No message library is installed"),
            LibraryError::NotFound => write!(f, "No such message in the library"),
            LibraryError::Invalid(why) => write!(f, "{}", why),
            LibraryError::Sql(e) => write!(f, "Message library error: {}", e),
            LibraryError::Io(e) => write!(f, "Could not copy the message library: {}", e),
        }
    }
}

impl From<rusqlite::Error> for LibraryError {
    fn from(e: rusqlite::Error) -> Self {
        LibraryError::Sql(e)
    }
}

impl From<std::io::Error> for LibraryError {
    fn from(e: std::io::Error) -> Self {
        LibraryError::Io(e)
    }
}

type Result<T> = std::result::Result<T, LibraryError>;

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
pub struct Status {
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_collection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub book_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub built_at: Option<String>,
    /// Changes whenever paragraph numbering changes, so references saved in
    /// collections can tell they were made against a different library.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub numbering_id: Option<String>,
    pub message_count: i64,
    pub book_chapter_count: i64,
    pub paragraph_count: i64,
}

/// One message or book chapter, without its text: the catalogue the tab
/// browses and searches by title, date and date code.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Work {
    pub code: String,
    /// "message" or "book".
    pub kind: String,
    pub collection: Option<String>,
    pub title: String,
    pub chapter: Option<i64>,
    pub location: Option<String>,
    pub year: Option<i64>,
    pub sort: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Paragraph {
    pub id: i64,
    pub number: i64,
    pub text: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct Message {
    #[serde(flatten)]
    pub work: Work,
    pub paragraphs: Vec<Paragraph>,
}

#[derive(Debug, Clone, Default)]
pub struct SearchFilter {
    /// "message" or "book".
    pub kind: Option<String>,
    pub year_from: Option<i64>,
    pub year_to: Option<i64>,
    /// Only this message or chapter (search within the open message).
    pub code: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct Hit {
    /// "phrase" (the words in the order typed) or "all" (all the words, any order).
    pub group: &'static str,
    pub paragraph_id: i64,
    pub code: String,
    pub number: i64,
    pub title: String,
    pub kind: String,
    pub chapter: Option<i64>,
    pub location: Option<String>,
    pub year: Option<i64>,
    /// Text around the match, matched words between MATCH_START and MATCH_END.
    pub snippet: String,
    pub score: f64,
}

/// The words of a query: letters and digits only, everything else separates
/// words (as the library's unicode61 tokeniser does).
fn words_of(raw: &str) -> Vec<String> {
    raw.chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

/// The FTS5 queries to run, in order: the exact phrase first, then all the
/// words in any order. Unless the query ends with a space, the last word may be
/// partly typed. Every word is quoted, so AND, OR, NOT and NEAR are searched
/// for rather than read as operators.
pub fn fts_queries(raw: &str) -> Vec<(&'static str, String)> {
    let words = words_of(raw);
    let Some(last) = words.last() else {
        return Vec::new();
    };
    let prefix = if raw.ends_with(char::is_whitespace) { "" } else { "*" };
    let mut all: Vec<String> = words[..words.len() - 1]
        .iter()
        .map(|w| format!("\"{}\"", w))
        .collect();
    all.push(format!("\"{}\"{}", last, prefix));
    let all = all.join(" ");
    if words.len() == 1 {
        return vec![("all", all)];
    }
    let phrase = format!("\"{}\"{}", words.join(" "), prefix);
    vec![("phrase", phrase), ("all", all)]
}

fn open_read_only(path: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    Ok(conn)
}

fn has_columns(conn: &Connection, table: &str, columns: &[&str]) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let present: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(columns.iter().all(|c| present.iter().any(|p| p == c)))
}

fn meta(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

fn status_of(conn: &Connection) -> Result<Status> {
    let count = |sql: &str| -> Result<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    Ok(Status {
        installed: true,
        tab_label: meta(conn, "tab_label")?,
        book_collection: meta(conn, "book_collection")?,
        book_title: meta(conn, "book_title")?,
        language: meta(conn, "language")?,
        built_at: meta(conn, "built_at")?,
        numbering_id: meta(conn, "numbering_id")?,
        message_count: count("SELECT COUNT(*) FROM messages WHERE kind = 'message'")?,
        book_chapter_count: count("SELECT COUNT(*) FROM messages WHERE kind = 'book'")?,
        paragraph_count: count("SELECT COUNT(*) FROM paragraphs")?,
    })
}

/// Checks that the file at `path` is a message library this build can read,
/// and returns what it holds. The file is only read.
pub fn validate(path: &Path) -> Result<Status> {
    let not_a_library = || {
        LibraryError::Invalid("This file is not a HymnBeam message library.".to_string())
    };
    let conn = open_read_only(path).map_err(|_| not_a_library())?;
    // A file that isn't SQLite at all fails on its first read.
    let app_id: i64 = conn
        .query_row("PRAGMA application_id", [], |r| r.get(0))
        .map_err(|_| not_a_library())?;
    if app_id != APPLICATION_ID {
        return Err(not_a_library());
    }
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version != FORMAT_VERSION {
        return Err(LibraryError::Invalid(format!(
            "This message library is format {}, but this version of HymnBeam reads format {}.{}",
            version,
            FORMAT_VERSION,
            if version > FORMAT_VERSION { " Update HymnBeam to use it." } else { "" }
        )));
    }
    let shape_ok = has_columns(&conn, "meta", &["key", "value"])?
        && has_columns(
            &conn,
            "messages",
            &["code", "kind", "collection", "title", "chapter", "location", "year", "sort"],
        )?
        && has_columns(&conn, "paragraphs", &["id", "code", "number", "text"])?
        && has_columns(&conn, "paragraphs_fts", &["text"])?;
    if !shape_ok {
        return Err(LibraryError::Invalid(
            "This message library is incomplete (tables are missing).".to_string(),
        ));
    }
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(LibraryError::Invalid(
            "This message library file is damaged. Copy it again and retry.".to_string(),
        ));
    }
    status_of(&conn)
}

/// An installed (or not yet installed) library at a fixed path. The app has one,
/// in its data folder (see `library()`); tests make their own.
pub struct Library {
    path: PathBuf,
    conn: Mutex<Option<Connection>>,
}

impl Library {
    pub fn new(path: PathBuf) -> Self {
        Library {
            path,
            conn: Mutex::new(None),
        }
    }

    #[cfg(test)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn importing_path(&self) -> PathBuf {
        self.path.with_file_name(IMPORTING_NAME)
    }

    /// Runs `f` on the library's connection, opening it on first use.
    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let mut guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            if !self.path.exists() {
                return Err(LibraryError::NotInstalled);
            }
            *guard = Some(open_read_only(&self.path)?);
        }
        f(guard.as_ref().expect("connection was just opened"))
    }

    pub fn status(&self) -> Result<Status> {
        match self.with_conn(status_of) {
            Err(LibraryError::NotInstalled) => Ok(Status::default()),
            other => other,
        }
    }

    pub fn catalogue(&self) -> Result<Vec<Work>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT code, kind, collection, title, chapter, location, year, sort
                 FROM messages ORDER BY kind != 'book', sort, code",
            )?;
            let rows = stmt.query_map([], work_from_row)?;
            Ok(rows.collect::<rusqlite::Result<_>>()?)
        })
    }

    pub fn message(&self, code: &str) -> Result<Message> {
        self.with_conn(|conn| {
            let work = conn
                .query_row(
                    "SELECT code, kind, collection, title, chapter, location, year, sort
                     FROM messages WHERE code = ?1",
                    [code],
                    work_from_row,
                )
                .optional()?
                .ok_or(LibraryError::NotFound)?;
            let mut stmt = conn.prepare(
                "SELECT id, number, text FROM paragraphs WHERE code = ?1 ORDER BY number, id",
            )?;
            let paragraphs = stmt
                .query_map([code], |r| {
                    Ok(Paragraph {
                        id: r.get(0)?,
                        number: r.get(1)?,
                        text: r.get(2)?,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?;
            Ok(Message { work, paragraphs })
        })
    }

    /// Paragraphs matching `raw`: exact-phrase matches first, then paragraphs
    /// with all the words in any order; best match (bm25) first within each.
    pub fn search(&self, raw: &str, filter: &SearchFilter, limit: u32) -> Result<Vec<Hit>> {
        let queries = fts_queries(raw);
        let limit = limit.clamp(1, MAX_SEARCH_LIMIT) as usize;
        self.with_conn(|conn| {
            let mut extra = String::new();
            let mut params: Vec<rusqlite::types::Value> = Vec::new();
            if let Some(kind) = &filter.kind {
                extra.push_str(" AND m.kind = ?");
                params.push(kind.clone().into());
            }
            if let Some(y) = filter.year_from {
                extra.push_str(" AND m.year >= ?");
                params.push(y.into());
            }
            if let Some(y) = filter.year_to {
                extra.push_str(" AND m.year <= ?");
                params.push(y.into());
            }
            if let Some(code) = &filter.code {
                extra.push_str(" AND m.code = ?");
                params.push(code.clone().into());
            }
            let sql = format!(
                "SELECT p.id, p.code, p.number, m.title, m.kind, m.chapter, m.location, m.year,
                        snippet(paragraphs_fts, 0, ?, ?, '…', 16) AS snip,
                        bm25(paragraphs_fts) AS score
                 FROM paragraphs_fts
                 JOIN paragraphs p ON p.id = paragraphs_fts.rowid
                 JOIN messages m ON m.code = p.code
                 WHERE paragraphs_fts MATCH ?{}
                 ORDER BY score
                 LIMIT ?",
                extra
            );
            let mut stmt = conn.prepare(&sql)?;
            let mut hits: Vec<Hit> = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for (group, query) in &queries {
                let group: &'static str = group;
                let mut bound: Vec<rusqlite::types::Value> = vec![
                    MATCH_START.to_string().into(),
                    MATCH_END.to_string().into(),
                    query.clone().into(),
                ];
                bound.extend(params.iter().cloned());
                bound.push((limit as i64).into());
                let rows = stmt.query_map(rusqlite::params_from_iter(bound), |r| {
                    Ok(Hit {
                        group,
                        paragraph_id: r.get(0)?,
                        code: r.get(1)?,
                        number: r.get(2)?,
                        title: r.get(3)?,
                        kind: r.get(4)?,
                        chapter: r.get(5)?,
                        location: r.get(6)?,
                        year: r.get(7)?,
                        snippet: r.get(8)?,
                        score: r.get(9)?,
                    })
                })?;
                for hit in rows {
                    let hit = hit?;
                    if seen.insert(hit.paragraph_id) {
                        hits.push(hit);
                    }
                }
                if hits.len() >= limit {
                    break;
                }
            }
            hits.truncate(limit);
            Ok(hits)
        })
    }

    /// Installs the library file at `source`, replacing any installed one. The
    /// file is copied next to the installed library, checked, and only then
    /// swapped in, so a failed or interrupted import leaves the old library as
    /// it was. `progress(copied, total)` is called as the copy proceeds.
    /// Searches keep working during the copy; the lock is held only for the swap.
    pub fn import(&self, source: &Path, mut progress: impl FnMut(u64, u64)) -> Result<Status> {
        let importing = self.importing_path();
        if let Some(dir) = importing.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let result = (|| {
            copy_with_progress(source, &importing, &mut progress)?;
            // validate() opens and closes its own connection, so nothing holds
            // the copy open when it is renamed (Windows refuses to rename open files).
            let status = validate(&importing)?;
            let mut guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            *guard = None; // close the old library before replacing it
            std::fs::rename(&importing, &self.path)?;
            *guard = Some(open_read_only(&self.path)?);
            Ok(status)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&importing);
        }
        result
    }

    /// Removes the installed library. Not having one is not an error.
    pub fn remove(&self) -> Result<Status> {
        let mut guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        *guard = None;
        for path in [self.path.clone(), self.importing_path()] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(Status::default())
    }
}

fn work_from_row(r: &rusqlite::Row) -> rusqlite::Result<Work> {
    Ok(Work {
        code: r.get(0)?,
        kind: r.get(1)?,
        collection: r.get(2)?,
        title: r.get(3)?,
        chapter: r.get(4)?,
        location: r.get(5)?,
        year: r.get(6)?,
        sort: r.get(7)?,
    })
}

fn copy_with_progress(
    source: &Path,
    dest: &Path,
    progress: &mut impl FnMut(u64, u64),
) -> Result<()> {
    let mut input = File::open(source)?;
    let total = input.metadata()?.len();
    let mut output = File::create(dest)?;
    let mut buf = vec![0u8; 1 << 20];
    let mut copied = 0u64;
    progress(0, total);
    loop {
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        output.write_all(&buf[..n])?;
        copied += n as u64;
        progress(copied, total);
    }
    output.sync_all()?;
    Ok(())
}

static LIBRARY: OnceCell<Library> = OnceCell::new();

/// The app's library, `messages.db` in the HymnBeam data folder next to songs.db.
pub fn library() -> &'static Library {
    LIBRARY.get_or_init(|| Library::new(app_library_path()))
}

#[cfg(not(test))]
fn app_library_path() -> PathBuf {
    let db = crate::db::get_db_path();
    let dir = db.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    dir.join(FILE_NAME)
}

// Tests' songs.db lives directly in the system temp folder, so the app's
// library gets a folder of its own instead of sitting beside it.
#[cfg(test)]
fn app_library_path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("hymnbeam-test-messages-{}", std::process::id()))
        .join(FILE_NAME)
}

#[cfg(test)]
pub(crate) mod test_util {
    use super::*;

    // The library file format, as the (separate) library builder writes it.
    pub const SCHEMA: &str = r#"
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE messages(
            code       TEXT PRIMARY KEY,
            kind       TEXT NOT NULL CHECK (kind IN ('message', 'book')),
            collection TEXT,
            title      TEXT NOT NULL,
            chapter    INTEGER,
            location   TEXT,
            year       INTEGER,
            sort       INTEGER NOT NULL,
            source     TEXT NOT NULL
        );
        CREATE TABLE paragraphs(
            id     INTEGER PRIMARY KEY,
            code   TEXT NOT NULL REFERENCES messages(code),
            number INTEGER NOT NULL,
            text   TEXT NOT NULL
        );
        CREATE INDEX idx_paragraphs_code_number ON paragraphs(code, number);
        CREATE VIRTUAL TABLE paragraphs_fts USING fts5(
            text, content='paragraphs', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
        CREATE VIRTUAL TABLE titles_fts USING fts5(
            title, content='messages', tokenize='unicode61 remove_diacritics 2');
    "#;

    pub struct Entry {
        pub code: &'static str,
        pub kind: &'static str,
        pub title: &'static str,
        pub chapter: Option<i64>,
        pub year: Option<i64>,
        pub paragraphs: &'static [&'static str],
    }

    // Made-up text only. No real message text belongs in this repository.
    pub const FIRST: &[Entry] = &[
        Entry {
            code: "BK-01",
            kind: "book",
            title: "The Lantern Chapter",
            chapter: Some(1),
            year: None,
            paragraphs: &[
                "A lantern hung by the harbour wall all through the winter.",
                "The keeper trimmed the wick at dusk and again before dawn.",
            ],
        },
        Entry {
            code: "50-0101",
            kind: "message",
            title: "Morning Over The Valley",
            chapter: None,
            year: Some(1950),
            paragraphs: &[
                "The river ran quietly past the mill [a note in brackets].",
                "Quietly the mill ran past the river, and the wheel turned.",
                "Faith AND works, NEAR the old bridge, NOT far from town.",
                "Cafe owners in the valley served bread before sunrise.",
            ],
        },
        Entry {
            code: "60-0202E",
            kind: "message",
            title: "Evening By The River",
            chapter: None,
            year: Some(1960),
            paragraphs: &[
                "The river ran quietly past the mill once more that evening.",
                "Mill workers rested by the river after the long day.",
            ],
        },
    ];

    pub const SECOND: &[Entry] = &[Entry {
        code: "55-0303",
        kind: "message",
        title: "A Replacement Library",
        chapter: None,
        year: Some(1955),
        paragraphs: &["Only this paragraph is in the second library."],
    }];

    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "hymnbeam-messages-{}-{}-{}",
                name,
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        pub fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    pub fn build_library(path: &Path, entries: &[Entry], app_id: i64, version: i64) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch(&format!(
            "PRAGMA application_id = {}; PRAGMA user_version = {};",
            app_id, version
        ))
        .unwrap();
        for (key, value) in [
            ("format_version", "1"),
            ("tab_label", "The Test Tab"),
            ("book_collection", "Test Book"),
            ("numbering_id", "abc123"),
            ("built_at", "2026-01-01T00:00:00Z"),
        ] {
            conn.execute("INSERT INTO meta VALUES (?1, ?2)", [key, value]).unwrap();
        }
        let mut id = 0;
        for (sort, e) in entries.iter().enumerate() {
            conn.execute(
                "INSERT INTO messages (code, kind, collection, title, chapter, location, year, sort, source)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'Testville', ?6, ?7, 'test')",
                rusqlite::params![
                    e.code,
                    e.kind,
                    if e.kind == "book" { Some("Test Book") } else { None },
                    e.title,
                    e.chapter,
                    e.year,
                    sort as i64
                ],
            )
            .unwrap();
            for (n, text) in e.paragraphs.iter().enumerate() {
                id += 1;
                conn.execute(
                    "INSERT INTO paragraphs (id, code, number, text) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![id, e.code, n as i64 + 1, text],
                )
                .unwrap();
            }
        }
        conn.execute_batch(
            "INSERT INTO paragraphs_fts(paragraphs_fts) VALUES('rebuild');
             INSERT INTO titles_fts(titles_fts) VALUES('rebuild');",
        )
        .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::test_util::*;
    use super::*;

    fn installed(dir: &TempDir, entries: &[Entry]) -> Library {
        let source = dir.join("source.db");
        build_library(&source, entries, APPLICATION_ID, FORMAT_VERSION);
        let lib = Library::new(dir.join("installed/messages.db"));
        lib.import(&source, |_, _| {}).expect("import");
        lib
    }

    fn found(hits: &[Hit]) -> Vec<(&'static str, String, i64)> {
        hits.iter()
            .map(|h| (h.group, h.code.clone(), h.number))
            .collect()
    }

    #[test]
    fn query_builder_quotes_words_and_prefixes_the_last() {
        assert_eq!(
            fts_queries("the river ran"),
            vec![
                ("phrase", "\"the river ran\"*".to_string()),
                ("all", "\"the\" \"river\" \"ran\"*".to_string()),
            ]
        );
        // A trailing space means the last word is finished: no prefix.
        assert_eq!(
            fts_queries("river ran "),
            vec![
                ("phrase", "\"river ran\"".to_string()),
                ("all", "\"river\" \"ran\"".to_string()),
            ]
        );
        // One word: no phrase query.
        assert_eq!(fts_queries("rive"), vec![("all", "\"rive\"*".to_string())]);
        // Punctuation separates words and never reaches FTS5 (the last word is
        // still a prefix, as the query doesn't end with a space).
        assert_eq!(
            fts_queries("\"mill\" (wheel)-turned*"),
            vec![
                ("phrase", "\"mill wheel turned\"*".to_string()),
                ("all", "\"mill\" \"wheel\" \"turned\"*".to_string()),
            ]
        );
        assert!(fts_queries("  ?! ").is_empty());
    }

    #[test]
    fn not_installed_until_imported() {
        let dir = TempDir::new("absent");
        let lib = Library::new(dir.join("messages.db"));
        assert_eq!(lib.status().unwrap(), Status::default());
        assert!(matches!(lib.catalogue(), Err(LibraryError::NotInstalled)));
        assert!(matches!(lib.message("50-0101"), Err(LibraryError::NotInstalled)));
        assert!(matches!(
            lib.search("river", &SearchFilter::default(), 20),
            Err(LibraryError::NotInstalled)
        ));
        // Removing when nothing is installed is fine.
        assert_eq!(lib.remove().unwrap(), Status::default());
    }

    #[test]
    fn import_then_read_status_catalogue_and_message() {
        let dir = TempDir::new("read");
        let lib = installed(&dir, FIRST);

        let status = lib.status().unwrap();
        assert!(status.installed);
        assert_eq!(status.tab_label.as_deref(), Some("The Test Tab"));
        assert_eq!(status.numbering_id.as_deref(), Some("abc123"));
        assert_eq!(
            (status.message_count, status.book_chapter_count, status.paragraph_count),
            (2, 1, 8)
        );

        let codes: Vec<String> = lib.catalogue().unwrap().into_iter().map(|w| w.code).collect();
        assert_eq!(codes, vec!["BK-01", "50-0101", "60-0202E"]); // book first, then by sort

        let msg = lib.message("50-0101").unwrap();
        assert_eq!(msg.work.title, "Morning Over The Valley");
        assert_eq!(msg.work.year, Some(1950));
        let numbers: Vec<i64> = msg.paragraphs.iter().map(|p| p.number).collect();
        assert_eq!(numbers, vec![1, 2, 3, 4]);
        assert!(matches!(lib.message("99-9999"), Err(LibraryError::NotFound)));
        assert!(!dir.join("installed/messages.db.importing").exists());
    }

    #[test]
    fn exact_phrase_comes_before_all_words() {
        let dir = TempDir::new("order");
        let lib = installed(&dir, FIRST);
        let hits = lib
            .search("river ran quietly", &SearchFilter::default(), 20)
            .unwrap();
        let found = found(&hits);
        // Both paragraphs with the phrase come first; the one with the same
        // words in another order comes after them.
        assert_eq!(found.len(), 3);
        assert!(found[..2].iter().all(|(g, _, _)| *g == "phrase"));
        assert_eq!(found[2], ("all", "50-0101".to_string(), 2));
        // No paragraph appears twice.
        let ids: std::collections::HashSet<i64> = hits.iter().map(|h| h.paragraph_id).collect();
        assert_eq!(ids.len(), hits.len());
    }

    #[test]
    fn search_prefix_operators_diacritics_and_snippets() {
        let dir = TempDir::new("search");
        let lib = installed(&dir, FIRST);
        let any = SearchFilter::default();

        // The last word may be partly typed.
        assert_eq!(found(&lib.search("harbour wa", &any, 20).unwrap())[0].1, "BK-01");
        // Operator words are searched for, not obeyed.
        let ops = lib.search("faith AND works NEAR", &any, 20).unwrap();
        assert_eq!(found(&ops), vec![("phrase", "50-0101".to_string(), 3)]);
        assert_eq!(lib.search("NOT far", &any, 20).unwrap().len(), 1);
        // Accents are ignored both ways.
        assert_eq!(lib.search("café", &any, 20).unwrap().len(), 1);
        // Matched words are marked, and the text's own brackets are untouched.
        let hit = &lib.search("mill brackets", &any, 20).unwrap()[0];
        assert!(hit.snippet.contains(&format!("{}brackets{}", MATCH_START, MATCH_END)));
        assert!(hit.snippet.contains('['));
        // Nothing searchable typed: no results, no error.
        assert!(lib.search(" ** ", &any, 20).unwrap().is_empty());
    }

    #[test]
    fn search_filters_and_limit() {
        let dir = TempDir::new("filters");
        let lib = installed(&dir, FIRST);
        let codes = |filter: SearchFilter| -> Vec<String> {
            lib.search("the", &filter, 20).unwrap().into_iter().map(|h| h.code).collect()
        };
        assert!(codes(SearchFilter { kind: Some("book".into()), ..Default::default() })
            .iter()
            .all(|c| c == "BK-01"));
        assert!(codes(SearchFilter { year_from: Some(1955), ..Default::default() })
            .iter()
            .all(|c| c == "60-0202E"));
        assert!(codes(SearchFilter { year_to: Some(1955), ..Default::default() })
            .iter()
            .all(|c| c == "50-0101"));
        assert!(codes(SearchFilter { code: Some("60-0202E".into()), ..Default::default() })
            .iter()
            .all(|c| c == "60-0202E"));
        assert_eq!(lib.search("the", &SearchFilter::default(), 2).unwrap().len(), 2);
    }

    #[test]
    fn rejects_files_that_are_not_usable_libraries() {
        let dir = TempDir::new("reject");
        let lib = installed(&dir, FIRST);
        let reject = |path: &Path| match lib.import(path, |_, _| {}) {
            Err(LibraryError::Invalid(why)) => why,
            other => panic!("expected the import to be refused, got {:?}", other.map(|_| ())),
        };

        let text = dir.join("notes.db");
        std::fs::write(&text, "not a database at all, just some words").unwrap();
        assert!(reject(&text).contains("not a HymnBeam message library"));

        let other_app = dir.join("other.db");
        build_library(&other_app, SECOND, 0x1234, FORMAT_VERSION);
        assert!(reject(&other_app).contains("not a HymnBeam message library"));

        let newer = dir.join("newer.db");
        build_library(&newer, SECOND, APPLICATION_ID, FORMAT_VERSION + 1);
        assert!(reject(&newer).contains("Update HymnBeam"));

        let incomplete = dir.join("incomplete.db");
        build_library(&incomplete, SECOND, APPLICATION_ID, FORMAT_VERSION);
        Connection::open(&incomplete)
            .unwrap()
            .execute_batch("DROP TABLE paragraphs_fts;")
            .unwrap();
        assert!(reject(&incomplete).contains("incomplete"));

        // A missing file is an I/O error, not a crash.
        assert!(matches!(
            lib.import(&dir.join("missing.db"), |_, _| {}),
            Err(LibraryError::Io(_))
        ));

        // Every refusal left the installed library as it was, and no copy behind.
        assert_eq!(lib.status().unwrap().message_count, 2);
        assert_eq!(lib.search("lantern", &SearchFilter::default(), 20).unwrap().len(), 1);
        assert!(!dir.join("installed/messages.db.importing").exists());
    }

    #[test]
    fn replacing_an_open_library_then_removing_it() {
        let dir = TempDir::new("replace");
        let lib = installed(&dir, FIRST);
        // Use the library so its file is open, as it is in a running app.
        assert_eq!(lib.search("lantern", &SearchFilter::default(), 20).unwrap().len(), 1);

        let second = dir.join("second.db");
        build_library(&second, SECOND, APPLICATION_ID, FORMAT_VERSION);
        let mut calls = Vec::new();
        let status = lib.import(&second, |copied, total| calls.push((copied, total))).unwrap();
        assert_eq!(status.message_count, 1);
        let total = std::fs::metadata(&second).unwrap().len();
        assert_eq!(calls.first(), Some(&(0, total)));
        assert_eq!(calls.last(), Some(&(total, total)));

        // The replacement is what's searched now.
        assert!(lib.search("lantern", &SearchFilter::default(), 20).unwrap().is_empty());
        assert_eq!(lib.search("second library", &SearchFilter::default(), 20).unwrap().len(), 1);
        assert_eq!(lib.catalogue().unwrap().len(), 1);

        assert!(!lib.remove().unwrap().installed);
        assert!(!lib.path().exists());
        assert!(matches!(lib.catalogue(), Err(LibraryError::NotInstalled)));
        assert!(!lib.status().unwrap().installed);
    }

    // Import, parity and speed against a real library, which never enters this
    // repository. The library is first imported into a temporary folder (the
    // full copy, check and swap), then searched. Run with:
    //   HYMNBEAM_MESSAGE_LIBRARY=/path/to/messages.db \
    //   HYMNBEAM_SEARCH_PARITY=/path/to/parity.json \
    //   cargo test --release parity_with_reference_search -- --ignored --nocapture
    // parity.json holds the reference search's results for a set of queries.
    #[test]
    #[ignore]
    fn parity_with_reference_search() {
        let lib_path = std::env::var("HYMNBEAM_MESSAGE_LIBRARY").expect("HYMNBEAM_MESSAGE_LIBRARY");
        let parity = std::env::var("HYMNBEAM_SEARCH_PARITY").expect("HYMNBEAM_SEARCH_PARITY");
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(&std::fs::read_to_string(parity).unwrap()).unwrap();
        let dir = TempDir::new("parity");
        let lib = Library::new(dir.join("messages.db"));
        let start = std::time::Instant::now();
        let status = lib.import(Path::new(&lib_path), |_, _| {}).expect("import the real library");
        println!(
            "imported {} messages, {} book chapters, {} paragraphs in {:.1} s",
            status.message_count,
            status.book_chapter_count,
            status.paragraph_count,
            start.elapsed().as_secs_f64()
        );

        let mut times = Vec::new();
        let mut mismatches = 0;
        for case in &cases {
            let query = case["query"].as_str().unwrap();
            let filter = SearchFilter {
                kind: case["kind"].as_str().map(str::to_string),
                year_from: case["year"].as_i64(),
                year_to: case["year"].as_i64(),
                code: None,
            };
            let expected: Vec<(String, String, i64)> = case["hits"]
                .as_array()
                .unwrap()
                .iter()
                .map(|h| {
                    (
                        h[0].as_str().unwrap().to_string(),
                        h[1].as_str().unwrap().to_string(),
                        h[2].as_i64().unwrap(),
                    )
                })
                .collect();
            let start = std::time::Instant::now();
            let hits = lib.search(query, &filter, DEFAULT_SEARCH_LIMIT).unwrap();
            times.push(start.elapsed());
            let got: Vec<(String, String, i64)> = hits
                .iter()
                .map(|h| (h.group.to_string(), h.code.clone(), h.number))
                .collect();
            if got != expected {
                mismatches += 1;
                if mismatches <= 5 {
                    println!("mismatch for {:?}:\n  rust   {:?}\n  python {:?}", query, got, expected);
                }
            }
        }
        times.sort();
        let ms = |d: std::time::Duration| d.as_secs_f64() * 1000.0;
        println!(
            "{} queries, {} mismatches; median {:.1} ms, 95th percentile {:.1} ms, slowest {:.1} ms",
            cases.len(),
            mismatches,
            ms(times[times.len() / 2]),
            ms(times[times.len() * 95 / 100]),
            ms(*times.last().unwrap())
        );
        assert_eq!(mismatches, 0);
        assert!(*times.last().unwrap() < std::time::Duration::from_secs(1));
    }
}
