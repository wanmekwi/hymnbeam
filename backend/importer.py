import json
import csv
import re
from pathlib import Path
from songs import Song, Verse, create_song


def parse_lyrics_to_verses(lyrics: str) -> list[Verse]:
    """Parse raw lyrics text with section markers into verses."""
    if not lyrics or not lyrics.strip():
        return []
    
    section_pattern = re.compile(
        r'^(Verse\s*\d*|Chorus|CHORUS|Bridge|Intro|Outro|Pre-Chorus|Pre Chorus|Tag|Refrain|Coda|Verse\d+)\s*$',
        re.IGNORECASE
    )
    
    paragraphs = re.split(r'\n\s*\n+', lyrics.strip())
    verses = []
    verse_counter = 1
    chorus_counter = 1
    
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        lines = para.split('\n')
        first_line = lines[0].strip()
        
        match = section_pattern.match(first_line)
        if match:
            label = match.group(1).strip()
            label = re.sub(r'(\d+)', r' \1', label).strip()
            label = label.title()
            
            if label.lower() == 'chorus':
                label = f"Chorus"
            
            text = '\n'.join(line.strip() for line in lines[1:]).strip()
            
            if text:
                verses.append(Verse(label=label, text=text))
        else:
            text = '\n'.join(line.strip() for line in lines).strip()
            
            if text:
                text_lower = text.lower()
                if len(verses) > 0 and any(v.text.lower() == text_lower for v in verses):
                    for v in verses:
                        if v.text.lower() == text_lower:
                            verses.append(Verse(label=v.label, text=text))
                            break
                else:
                    verses.append(Verse(label=f"Verse {verse_counter}", text=text))
                    verse_counter += 1
    
    return verses


def import_json(file_path: str) -> list[int]:
    """Import songs from a JSON file. Handles both single song and array formats."""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    if isinstance(data, list):
        return import_hymns_array(data)
    
    verses = [
        Verse(label=v.get("label", f"Verse {i+1}"), text=v["text"])
        for i, v in enumerate(data.get("verses", []))
    ]
    
    song = Song(
        title=data["title"],
        author=data.get("author"),
        verses=verses,
        tags=data.get("tags", [])
    )
    
    return [create_song(song)]


def import_hymns_array(data: list[dict]) -> list[int]:
    """Import an array of hymns with lyrics field."""
    song_ids = []
    
    for item in data:
        title = item.get("title", "").strip()
        if not title:
            continue
        
        author = item.get("author", "").strip() or None
        lyrics = item.get("lyrics", "")
        
        verses = parse_lyrics_to_verses(lyrics) if lyrics else []
        
        musical_key = item.get("musicalKey", "").strip() or None
        
        tags = []
        if item.get("songNumber"):
            tags.append(f"#{item['songNumber']}")
        
        song = Song(
            title=title,
            author=author,
            musical_key=musical_key,
            verses=verses,
            tags=tags
        )
        
        try:
            song_ids.append(create_song(song))
        except Exception as e:
            print(f"Error importing '{title}': {e}")
            continue
    
    return song_ids


def import_csv(file_path: str) -> list[int]:
    """Import songs from a CSV file. Returns list of created song IDs."""
    songs_data: dict[str, dict] = {}
    
    with open(file_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            title = row["title"]
            if title not in songs_data:
                songs_data[title] = {
                    "title": title,
                    "author": row.get("author", ""),
                    "verses": []
                }
            songs_data[title]["verses"].append({
                "label": row.get("verse_label", f"Verse {len(songs_data[title]['verses']) + 1}"),
                "text": row["verse_text"]
            })
    
    song_ids = []
    for data in songs_data.values():
        song = Song(
            title=data["title"],
            author=data["author"] or None,
            verses=[Verse(label=v["label"], text=v["text"]) for v in data["verses"]]
        )
        song_ids.append(create_song(song))
    
    return song_ids


def import_text(file_path: str) -> int:
    """Import a song from a plain text file."""
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    
    lines = content.split("\n")
    
    title = lines[0].strip()
    author = lines[1].strip() if len(lines) > 1 and lines[1].strip() else None
    
    verse_pattern = re.compile(r"^\[(.+?)\]$")
    verses = []
    current_label = None
    current_text_lines = []
    
    start_line = 2 if author else 1
    
    for line in lines[start_line:]:
        line = line.strip()
        
        match = verse_pattern.match(line)
        if match:
            if current_label is not None:
                verses.append(Verse(
                    label=current_label,
                    text="\n".join(current_text_lines).strip()
                ))
            current_label = match.group(1)
            current_text_lines = []
        elif current_label is not None:
            current_text_lines.append(line)
        elif line:
            if current_label is None:
                current_label = f"Verse {len(verses) + 1}"
            current_text_lines.append(line)
    
    if current_label is not None and current_text_lines:
        verses.append(Verse(
            label=current_label,
            text="\n".join(current_text_lines).strip()
        ))
    
    song = Song(title=title, author=author, verses=verses)
    return create_song(song)


def import_file(file_path: str) -> list[int]:
    """Auto-detect file type and import."""
    path = Path(file_path)
    ext = path.suffix.lower()
    
    if ext == ".json":
        return import_json(file_path)
    elif ext == ".csv":
        return import_csv(file_path)
    elif ext in (".txt", ".text"):
        return [import_text(file_path)]
    else:
        raise ValueError(f"Unsupported file type: {ext}")
