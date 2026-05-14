import csv
import json
import io
from database import get_connection


def _get_all_songs_with_verses():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, author, musical_key FROM songs ORDER BY title")
    songs = cursor.fetchall()
    result = []
    for song in songs:
        cursor.execute(
            "SELECT label, text FROM verses WHERE song_id = ? ORDER BY position",
            (song['id'],)
        )
        verses = cursor.fetchall()
        result.append({
            'id': song['id'],
            'title': song['title'],
            'author': song['author'],
            'musical_key': song['musical_key'],
            'verses': [{'label': v['label'], 'text': v['text']} for v in verses]
        })
    conn.close()
    return result


def export_json() -> str:
    songs = _get_all_songs_with_verses()
    export = []
    for s in songs:
        export.append({
            'title': s['title'],
            'author': s['author'] or '',
            'key': s['musical_key'] or '',
            'verses': s['verses']
        })
    return json.dumps(export, indent=2, ensure_ascii=False)


def export_csv() -> str:
    songs = _get_all_songs_with_verses()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(['title', 'author', 'key', 'verse_label', 'verse_text'])
    for s in songs:
        if s['verses']:
            for v in s['verses']:
                writer.writerow([
                    s['title'],
                    s['author'] or '',
                    s['musical_key'] or '',
                    v['label'],
                    v['text']
                ])
        else:
            writer.writerow([s['title'], s['author'] or '', s['musical_key'] or '', '', ''])
    return buf.getvalue()


def export_txt() -> str:
    songs = _get_all_songs_with_verses()
    parts = []
    for s in songs:
        lines = [s['title']]
        if s['author']:
            lines.append(s['author'])
        if s['musical_key']:
            lines.append(f"Key: {s['musical_key']}")
        lines.append('')
        for v in s['verses']:
            lines.append(v['label'])
            lines.append(v['text'])
            lines.append('')
        parts.append('\n'.join(lines))
    return '\n---\n\n'.join(parts)
