from typing import Optional
from pydantic import BaseModel
from database import get_connection


class SetlistEntry(BaseModel):
    id: int           # setlist_songs row id (not song id — song can appear multiple times)
    song_id: int
    title: str
    author: Optional[str] = None
    musical_key: Optional[str] = None
    position: int


class Setlist(BaseModel):
    id: Optional[int] = None
    name: str
    songs: list[SetlistEntry] = []


class SetlistSummary(BaseModel):
    id: int
    name: str
    song_count: int


def get_all_setlists() -> list[SetlistSummary]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT sl.id, sl.name, COUNT(ss.id) as song_count
        FROM setlists sl
        LEFT JOIN setlist_songs ss ON ss.setlist_id = sl.id
        GROUP BY sl.id
        ORDER BY sl.created_at DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [SetlistSummary(id=r['id'], name=r['name'], song_count=r['song_count']) for r in rows]


def get_setlist(setlist_id: int) -> Optional[Setlist]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM setlists WHERE id = ?", (setlist_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
    cursor.execute("""
        SELECT ss.id, ss.song_id, ss.position, s.title, s.author, s.musical_key
        FROM setlist_songs ss
        JOIN songs s ON s.id = ss.song_id
        WHERE ss.setlist_id = ?
        ORDER BY ss.position
    """, (setlist_id,))
    songs = cursor.fetchall()
    conn.close()
    return Setlist(
        id=row['id'],
        name=row['name'],
        songs=[
            SetlistEntry(
                id=s['id'],
                song_id=s['song_id'],
                title=s['title'],
                author=s['author'],
                musical_key=s['musical_key'],
                position=s['position']
            )
            for s in songs
        ]
    )


def create_setlist(name: str) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO setlists (name) VALUES (?)", (name,))
    setlist_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return setlist_id


def rename_setlist(setlist_id: int, name: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE setlists SET name = ? WHERE id = ?", (name, setlist_id))
    updated = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return updated


def delete_setlist(setlist_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM setlists WHERE id = ?", (setlist_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


def add_song_to_setlist(setlist_id: int, song_id: int) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT MAX(position) as max_pos FROM setlist_songs WHERE setlist_id = ?",
        (setlist_id,)
    )
    row = cursor.fetchone()
    next_pos = (row['max_pos'] or 0) + 1
    cursor.execute(
        "INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES (?, ?, ?)",
        (setlist_id, song_id, next_pos)
    )
    entry_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return entry_id


def remove_song_from_setlist(setlist_id: int, entry_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM setlist_songs WHERE id = ? AND setlist_id = ?",
        (entry_id, setlist_id)
    )
    deleted = cursor.rowcount > 0
    if deleted:
        cursor.execute(
            "SELECT id FROM setlist_songs WHERE setlist_id = ? ORDER BY position",
            (setlist_id,)
        )
        for i, r in enumerate(cursor.fetchall(), 1):
            cursor.execute("UPDATE setlist_songs SET position = ? WHERE id = ?", (i, r['id']))
    conn.commit()
    conn.close()
    return deleted


def reorder_setlist_songs(setlist_id: int, ordered_entry_ids: list[int]) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    for pos, entry_id in enumerate(ordered_entry_ids, 1):
        cursor.execute(
            "UPDATE setlist_songs SET position = ? WHERE id = ? AND setlist_id = ?",
            (pos, entry_id, setlist_id)
        )
    conn.commit()
    conn.close()
    return True
