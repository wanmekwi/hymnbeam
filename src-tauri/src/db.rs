use once_cell::sync::OnceCell;
use rusqlite::{Connection, Result as SqliteResult};
use std::path::PathBuf;
use std::sync::Mutex;

static DB_PATH: OnceCell<PathBuf> = OnceCell::new();
static DB_POOL: OnceCell<Mutex<Connection>> = OnceCell::new();

pub fn init_db_path() -> PathBuf {
    let app_support = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Song Rays");
    std::fs::create_dir_all(&app_support).ok();
    app_support.join("songs.db")
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

pub fn init_db() -> SqliteResult<()> {
    let conn = get_connection()?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT,
            musical_key TEXT,
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
        "#,
    )?;

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
        "#,
    )?;

    Ok(())
}
