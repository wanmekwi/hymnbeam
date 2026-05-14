from typing import Optional
from pydantic import BaseModel
from database import get_connection


class Verse(BaseModel):
    id: Optional[int] = None
    label: str
    text: str
    position: Optional[int] = None


class Song(BaseModel):
    id: Optional[int] = None
    title: str
    author: Optional[str] = None
    musical_key: Optional[str] = None
    verses: list[Verse] = []
    tags: list[str] = []


class SongSummary(BaseModel):
    id: int
    title: str
    author: Optional[str] = None
    musical_key: Optional[str] = None
    verse_count: int = 0


def create_song(song: Song) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "INSERT INTO songs (title, author, musical_key) VALUES (?, ?, ?)",
        (song.title, song.author, song.musical_key)
    )
    song_id = cursor.lastrowid
    
    cursor.execute(
        "INSERT INTO songs_fts (rowid, title, author) VALUES (?, ?, ?)",
        (song_id, song.title, song.author or "")
    )
    
    for i, verse in enumerate(song.verses):
        cursor.execute(
            "INSERT INTO verses (song_id, label, text, position) VALUES (?, ?, ?, ?)",
            (song_id, verse.label, verse.text, i)
        )
        verse_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO verses_fts (rowid, text) VALUES (?, ?)",
            (verse_id, verse.text)
        )
    
    for tag_name in song.tags:
        cursor.execute(
            "INSERT OR IGNORE INTO tags (name) VALUES (?)",
            (tag_name,)
        )
        cursor.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
        tag_id = cursor.fetchone()[0]
        cursor.execute(
            "INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)",
            (song_id, tag_id)
        )
    
    conn.commit()
    conn.close()
    return song_id


def get_song(song_id: int) -> Optional[Song]:
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM songs WHERE id = ?", (song_id,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return None
    
    cursor.execute(
        "SELECT * FROM verses WHERE song_id = ? ORDER BY position",
        (song_id,)
    )
    verses_rows = cursor.fetchall()
    
    cursor.execute("""
        SELECT t.name FROM tags t
        JOIN song_tags st ON t.id = st.tag_id
        WHERE st.song_id = ?
    """, (song_id,))
    tags = [r[0] for r in cursor.fetchall()]
    
    conn.close()
    
    return Song(
        id=row["id"],
        title=row["title"],
        author=row["author"],
        musical_key=row["musical_key"] if "musical_key" in row.keys() else None,
        verses=[
            Verse(
                id=v["id"],
                label=v["label"],
                text=v["text"],
                position=v["position"]
            )
            for v in verses_rows
        ],
        tags=tags
    )


def get_sort_clause(sort_by: str) -> str:
    sort_options = {
        "title": "s.title ASC",
        "number": "s.id ASC",
        "key": "s.musical_key ASC, s.title ASC",
        "author": "s.author ASC, s.title ASC",
        "recent": "s.id DESC"
    }
    return sort_options.get(sort_by, "s.title ASC")


def get_all_songs(sort_by: str = "title") -> list[SongSummary]:
    conn = get_connection()
    cursor = conn.cursor()
    
    order_clause = get_sort_clause(sort_by)
    
    cursor.execute(f"""
        SELECT s.id, s.title, s.author, s.musical_key, COUNT(v.id) as verse_count
        FROM songs s
        LEFT JOIN verses v ON s.id = v.song_id
        GROUP BY s.id
        ORDER BY {order_clause}
    """)
    
    rows = cursor.fetchall()
    conn.close()
    
    return [
        SongSummary(
            id=r["id"],
            title=r["title"],
            author=r["author"],
            musical_key=r["musical_key"] if "musical_key" in r.keys() else None,
            verse_count=r["verse_count"]
        )
        for r in rows
    ]


def search_songs(query: str, sort_by: str = "title") -> list[SongSummary]:
    conn = get_connection()
    cursor = conn.cursor()
    
    order_clause = get_sort_clause(sort_by)
    like_term = f"%{query}%"
    
    try:
        fts_term = f"{query}*"
        cursor.execute(f"""
            SELECT DISTINCT s.id, s.title, s.author, s.musical_key, COUNT(v.id) as verse_count
            FROM songs s
            LEFT JOIN verses v ON s.id = v.song_id
            WHERE s.id IN (
                SELECT rowid FROM songs_fts WHERE songs_fts MATCH ?
            ) OR s.id IN (
                SELECT song_id FROM verses WHERE id IN (
                    SELECT rowid FROM verses_fts WHERE verses_fts MATCH ?
                )
            )
            GROUP BY s.id
            ORDER BY {order_clause}
        """, (fts_term, fts_term))
        rows = cursor.fetchall()
    except Exception:
        rows = []
    
    if not rows:
        cursor.execute(f"""
            SELECT DISTINCT s.id, s.title, s.author, s.musical_key, COUNT(v.id) as verse_count
            FROM songs s
            LEFT JOIN verses v ON s.id = v.song_id
            WHERE s.title LIKE ? COLLATE NOCASE
               OR s.author LIKE ? COLLATE NOCASE
               OR s.musical_key LIKE ? COLLATE NOCASE
               OR CAST(s.id AS TEXT) LIKE ?
               OR EXISTS (SELECT 1 FROM verses v2 WHERE v2.song_id = s.id AND v2.text LIKE ? COLLATE NOCASE)
            GROUP BY s.id
            ORDER BY {order_clause}
        """, (like_term, like_term, like_term, like_term, like_term))
        rows = cursor.fetchall()
    
    conn.close()
    
    return [
        SongSummary(
            id=r["id"],
            title=r["title"],
            author=r["author"],
            musical_key=r["musical_key"] if "musical_key" in r.keys() else None,
            verse_count=r["verse_count"]
        )
        for r in rows
    ]


def delete_song(song_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("DELETE FROM songs_fts WHERE rowid = ?", (song_id,))
    
    cursor.execute("SELECT id FROM verses WHERE song_id = ?", (song_id,))
    verse_ids = [r[0] for r in cursor.fetchall()]
    for vid in verse_ids:
        cursor.execute("DELETE FROM verses_fts WHERE rowid = ?", (vid,))
    
    cursor.execute("DELETE FROM songs WHERE id = ?", (song_id,))
    deleted = cursor.rowcount > 0
    
    conn.commit()
    conn.close()
    return deleted


def update_song(song_id: int, song: Song) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "UPDATE songs SET title = ?, author = ?, musical_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (song.title, song.author, song.musical_key, song_id)
    )
    
    if cursor.rowcount == 0:
        conn.close()
        return False
    
    cursor.execute(
        "UPDATE songs_fts SET title = ?, author = ? WHERE rowid = ?",
        (song.title, song.author or "", song_id)
    )
    
    cursor.execute("SELECT id FROM verses WHERE song_id = ?", (song_id,))
    old_verse_ids = [r[0] for r in cursor.fetchall()]
    for vid in old_verse_ids:
        cursor.execute("DELETE FROM verses_fts WHERE rowid = ?", (vid,))
    cursor.execute("DELETE FROM verses WHERE song_id = ?", (song_id,))
    
    for i, verse in enumerate(song.verses):
        cursor.execute(
            "INSERT INTO verses (song_id, label, text, position) VALUES (?, ?, ?, ?)",
            (song_id, verse.label, verse.text, i)
        )
        verse_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO verses_fts (rowid, text) VALUES (?, ?)",
            (verse_id, verse.text)
        )
    
    cursor.execute("DELETE FROM song_tags WHERE song_id = ?", (song_id,))
    for tag_name in song.tags:
        cursor.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
        cursor.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
        tag_id = cursor.fetchone()[0]
        cursor.execute(
            "INSERT OR IGNORE INTO song_tags (song_id, tag_id) VALUES (?, ?)",
            (song_id, tag_id)
        )
    
    conn.commit()
    conn.close()
    return True
