import os
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from database import init_db
from songs import Song, SongSummary, get_song, get_all_songs, search_songs, create_song, update_song, delete_song
from importer import import_file
from song_collections import (
    CollectionSummary, Collection,
    get_all_collections, get_collection, create_collection, rename_collection,
    delete_collection, add_song_to_collection, remove_song_from_collection,
    reorder_collection_songs
)
from export_songs import export_json, export_csv, export_txt


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Song Rays API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"status": "ok", "app": "Song Rays"}


@app.get("/songs", response_model=list[SongSummary])
async def list_songs(sort: str = "title"):
    return get_all_songs(sort_by=sort)


@app.get("/songs/search", response_model=list[SongSummary])
async def search(q: str = "", sort: str = "title"):
    if not q.strip():
        return get_all_songs(sort_by=sort)
    return search_songs(q, sort_by=sort)


@app.get("/songs/{song_id}", response_model=Song)
async def get_song_by_id(song_id: int):
    song = get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


@app.post("/songs", response_model=dict)
async def create_new_song(song: Song):
    song_id = create_song(song)
    return {"id": song_id, "message": "Song created"}


@app.put("/songs/{song_id}")
async def update_existing_song(song_id: int, song: Song):
    if not update_song(song_id, song):
        raise HTTPException(status_code=404, detail="Song not found")
    return {"message": "Song updated"}


@app.delete("/songs/{song_id}")
async def delete_existing_song(song_id: int):
    if not delete_song(song_id):
        raise HTTPException(status_code=404, detail="Song not found")
    return {"message": "Song deleted"}


@app.post("/import")
async def import_songs(file: UploadFile = File(...)):
    allowed_extensions = {".json", ".csv", ".txt", ".text"}
    ext = Path(file.filename).suffix.lower()

    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}"
        )

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        song_ids = import_file(tmp_path)
        return {"imported": len(song_ids), "song_ids": song_ids}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        os.unlink(tmp_path)


@app.get("/export")
async def export_songs(format: str = "json"):
    fmt = format.lower()
    if fmt == "json":
        content = export_json()
        media_type = "application/json"
        filename = "songs.json"
    elif fmt == "csv":
        content = export_csv()
        media_type = "text/csv"
        filename = "songs.csv"
    elif fmt == "txt":
        content = export_txt()
        media_type = "text/plain"
        filename = "songs.txt"
    else:
        raise HTTPException(status_code=400, detail="format must be json, csv, or txt")

    return Response(
        content=content.encode("utf-8"),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.get("/collections", response_model=list[CollectionSummary])
async def list_collections():
    return get_all_collections()


@app.post("/collections", response_model=dict)
async def create_new_collection(body: dict):
    name = body.get("name", "New Collection").strip() or "New Collection"
    collection_id = create_collection(name)
    return {"id": collection_id}


@app.get("/collections/{collection_id}", response_model=Collection)
async def get_collection_by_id(collection_id: int):
    c = get_collection(collection_id)
    if not c:
        raise HTTPException(status_code=404, detail="Collection not found")
    return c


@app.put("/collections/{collection_id}")
async def rename_existing_collection(collection_id: int, body: dict):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if not rename_collection(collection_id, name):
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"message": "Renamed"}


@app.delete("/collections/{collection_id}")
async def delete_existing_collection(collection_id: int):
    if not delete_collection(collection_id):
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"message": "Deleted"}


@app.post("/collections/{collection_id}/songs")
async def add_song_to_col(collection_id: int, body: dict):
    song_id = body.get("song_id")
    if not song_id:
        raise HTTPException(status_code=400, detail="song_id required")
    entry_id = add_song_to_collection(collection_id, song_id)
    return {"entry_id": entry_id}


@app.delete("/collections/{collection_id}/songs/{entry_id}")
async def remove_song_from_col(collection_id: int, entry_id: int):
    if not remove_song_from_collection(collection_id, entry_id):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"message": "Removed"}


@app.put("/collections/{collection_id}/reorder")
async def reorder_col_songs(collection_id: int, body: dict):
    ordered_ids = body.get("order", [])
    reorder_collection_songs(collection_id, ordered_ids)
    return {"message": "Reordered"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
