use axum::{
    body::Body,
    extract::{Multipart, Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::bible::{get_books, get_chapter, search_bible, SearchHit};
use crate::messages::{self, LibraryError, SearchFilter};
use crate::collections::{
    add_item_to_collection, create_collection, delete_collection, get_all_collections,
    get_collection, remove_song_from_collection, rename_collection, reorder_collection_songs,
};
use crate::backgrounds::{read_image, save_image};
use crate::export::{export_csv, export_json, export_txt};
use crate::import::{
    import_file, import_selected as import_selected_songs, parse_songs, replace_library,
};
use crate::models::Song;
use crate::settings::{get_settings, update_settings};
use crate::backup::{create_backup, list_backups, restore_backup};
use crate::songs::{
    create_song, delete_song, find_duplicates, find_song_id_by_number, get_all_songs, get_song,
    list_deleted_songs, restore_song, search_songs, set_source, update_song,
};

#[derive(Serialize)]
struct StatusResponse {
    status: &'static str,
    app: &'static str,
}

#[derive(Deserialize)]
struct SortQuery {
    #[serde(default = "default_sort")]
    sort: String,
}

fn default_sort() -> String {
    "number".to_string()
}

#[derive(Deserialize)]
struct SearchQuery {
    #[serde(default)]
    q: String,
    #[serde(default = "default_sort")]
    sort: String,
}

#[derive(Deserialize)]
struct ExportQuery {
    #[serde(default = "default_format")]
    format: String,
}

fn default_format() -> String {
    "json".to_string()
}

#[derive(Serialize)]
struct IdResponse {
    id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
}

#[derive(Serialize)]
struct MessageResponse {
    message: &'static str,
}

#[derive(Serialize)]
struct ImportResponse {
    imported: usize,
    song_ids: Vec<i64>,
}

#[derive(Serialize)]
struct EntryIdResponse {
    entry_id: i64,
}

#[derive(Deserialize)]
struct CreateCollectionBody {
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
struct RenameCollectionBody {
    name: String,
}

#[derive(Deserialize)]
struct AddItemBody {
    #[serde(default)]
    song_id: Option<i64>,
    #[serde(default)]
    item_type: Option<String>,
    #[serde(default)]
    reference: Option<String>,
}

#[derive(Deserialize)]
struct ReorderBody {
    order: Vec<i64>,
}

async fn root() -> Json<StatusResponse> {
    Json(StatusResponse {
        status: "ok",
        app: "HymnBeam",
    })
}

async fn list_songs(Query(params): Query<SortQuery>) -> Result<impl IntoResponse, StatusCode> {
    get_all_songs(&params.sort)
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn search(Query(params): Query<SearchQuery>) -> Result<impl IntoResponse, StatusCode> {
    if params.q.trim().is_empty() {
        get_all_songs(&params.sort)
            .map(Json)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    } else {
        search_songs(&params.q, &params.sort)
            .map(Json)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    }
}

async fn get_song_by_id(Path(song_id): Path<i64>) -> Result<impl IntoResponse, StatusCode> {
    match get_song(song_id) {
        Ok(Some(song)) => Ok(Json(song)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn create_new_song(Json(song): Json<Song>) -> Result<impl IntoResponse, StatusCode> {
    // UI-driven creates must not clobber an existing song's number. Imports
    // bypass this handler (they call create_song directly via import_file), so
    // those stay permissive — duplicates are still possible from imports, the
    // dedupe-on-fingerprint there handles the same-file re-import case.
    if let Some(ref n) = song.song_number {
        if find_song_id_by_number(n).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.is_some() {
            return Err(StatusCode::CONFLICT);
        }
    }
    create_song(&song)
        .map(|id| {
            Json(IdResponse {
                id,
                message: Some("Song created"),
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn update_existing_song(
    Path(song_id): Path<i64>,
    Json(song): Json<Song>,
) -> Result<impl IntoResponse, StatusCode> {
    if let Some(ref n) = song.song_number {
        let owner = find_song_id_by_number(n).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if let Some(other_id) = owner {
            if other_id != song_id {
                return Err(StatusCode::CONFLICT);
            }
        }
    }
    match update_song(song_id, &song) {
        Ok(true) => Ok(Json(MessageResponse {
            message: "Song updated",
        })),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn delete_existing_song(Path(song_id): Path<i64>) -> Result<impl IntoResponse, StatusCode> {
    match delete_song(song_id) {
        Ok(true) => Ok(Json(MessageResponse {
            message: "Song deleted",
        })),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

#[derive(Deserialize)]
struct ImportQuery {
    #[serde(default)]
    replace: bool,
}

async fn import_songs(
    Query(params): Query<ImportQuery>,
    mut multipart: Multipart,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let bad_request = |msg: &str| (StatusCode::BAD_REQUEST, msg.to_string());

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| bad_request("Invalid upload"))?
    {
        let filename = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "unknown.json".to_string());

        let ext = std::path::Path::new(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let allowed = ["json", "csv", "txt", "text"];
        if !allowed.contains(&ext.as_str()) {
            return Err(bad_request("Unsupported file type"));
        }

        let content = field.bytes().await.map_err(|_| bad_request("Invalid upload"))?;
        let content_str =
            String::from_utf8(content.to_vec()).map_err(|_| bad_request("File is not valid UTF-8"))?;

        let result = if params.replace {
            replace_library(&content_str, &filename)
        } else {
            import_file(&content_str, &filename)
        };
        let song_ids = result.map_err(|e| (StatusCode::BAD_REQUEST, e))?;

        return Ok(Json(ImportResponse {
            imported: song_ids.len(),
            song_ids,
        }));
    }

    Err(bad_request("No file provided"))
}

#[derive(Deserialize)]
struct PreviewBody {
    #[serde(default = "default_preview_filename")]
    filename: String,
    #[serde(default)]
    content: String,
}

fn default_preview_filename() -> String {
    "database.json".to_string()
}

// Parses another database file and returns its songs without importing. The
// browser dev fallback for the Tauri preview_import_database command.
async fn preview_import(
    Json(body): Json<PreviewBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    parse_songs(&body.content, &body.filename)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

#[derive(Deserialize)]
struct SelectedImportBody {
    #[serde(default)]
    songs: Vec<Song>,
    #[serde(default)]
    source: Option<String>,
}

// Imports a caller-selected set of songs (renumbered + source-tagged). Browser
// dev fallback for the Tauri import_selected_songs command.
async fn import_selected(
    Json(body): Json<SelectedImportBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    import_selected_songs(&body.songs, body.source.as_deref())
        .map(|ids| {
            Json(ImportResponse {
                imported: ids.len(),
                song_ids: ids,
            })
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

#[derive(Deserialize)]
struct SetSourceBody {
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    only_untagged: bool,
}

#[derive(Serialize)]
struct UpdatedResponse {
    updated: usize,
}

// Batch-assigns a source to existing songs. Browser dev fallback for the Tauri
// set_songs_source command.
async fn set_songs_source_handler(
    Json(body): Json<SetSourceBody>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    set_source(body.source.as_deref(), body.only_untagged)
        .map(|updated| Json(UpdatedResponse { updated }))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn list_trash() -> Result<impl IntoResponse, StatusCode> {
    list_deleted_songs()
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn restore_trashed_song(Path(song_id): Path<i64>) -> Result<impl IntoResponse, StatusCode> {
    match restore_song(song_id) {
        Ok(true) => Ok(Json(MessageResponse {
            message: "Song restored",
        })),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn list_duplicate_songs() -> Result<impl IntoResponse, StatusCode> {
    find_duplicates()
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn get_backups() -> Result<impl IntoResponse, StatusCode> {
    list_backups()
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn create_backup_handler() -> Result<impl IntoResponse, (StatusCode, String)> {
    create_backup("manual")
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))
}

async fn restore_backup_handler(
    Path(name): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    restore_backup(&name)
        .map(|_| {
            Json(MessageResponse {
                message: "Backup restored",
            })
        })
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}

async fn export_songs_handler(Query(params): Query<ExportQuery>) -> Result<Response, StatusCode> {
    let fmt = params.format.to_lowercase();

    let (content, media_type, filename) = match fmt.as_str() {
        "json" => (
            export_json().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            "application/json",
            "songs.json",
        ),
        "csv" => (
            export_csv().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            "text/csv",
            "songs.csv",
        ),
        "txt" => (
            export_txt().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            "text/plain",
            "songs.txt",
        ),
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, media_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(Body::from(content))
        .unwrap())
}

async fn list_collections() -> Result<impl IntoResponse, StatusCode> {
    get_all_collections()
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn create_new_collection(
    Json(body): Json<CreateCollectionBody>,
) -> Result<impl IntoResponse, StatusCode> {
    let name = body
        .name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "New Collection".to_string());

    create_collection(&name)
        .map(|id| Json(IdResponse { id, message: None }))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn get_collection_by_id(
    Path(collection_id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    match get_collection(collection_id) {
        Ok(Some(c)) => Ok(Json(c)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn rename_existing_collection(
    Path(collection_id): Path<i64>,
    Json(body): Json<RenameCollectionBody>,
) -> Result<impl IntoResponse, StatusCode> {
    if body.name.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    match rename_collection(collection_id, &body.name) {
        Ok(true) => Ok(Json(MessageResponse { message: "Renamed" })),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn delete_existing_collection(
    Path(collection_id): Path<i64>,
) -> Result<impl IntoResponse, StatusCode> {
    match delete_collection(collection_id) {
        Ok(true) => Ok(Json(MessageResponse { message: "Deleted" })),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn add_song_to_col(
    Path(collection_id): Path<i64>,
    Json(body): Json<AddItemBody>,
) -> Result<impl IntoResponse, StatusCode> {
    // item_type defaults to "song" so existing callers keep working.
    let item_type = body.item_type.as_deref().unwrap_or("song");
    let (song_id, reference): (Option<i64>, Option<String>) = match item_type {
        "song" => (Some(body.song_id.ok_or(StatusCode::BAD_REQUEST)?), None),
        "bible" => {
            let r = body
                .reference
                .filter(|s| !s.trim().is_empty())
                .ok_or(StatusCode::BAD_REQUEST)?;
            (None, Some(r))
        }
        "logo" => (None, None),
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    add_item_to_collection(collection_id, item_type, song_id, reference.as_deref())
        .map(|entry_id| Json(EntryIdResponse { entry_id }))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn remove_song_from_col(
    Path((collection_id, entry_id)): Path<(i64, i64)>,
) -> Result<impl IntoResponse, StatusCode> {
    match remove_song_from_collection(collection_id, entry_id) {
        Ok(true) => Ok(Json(MessageResponse { message: "Removed" })),
        Ok(false) => Err(StatusCode::NOT_FOUND),
        Err(_) => Err(StatusCode::INTERNAL_SERVER_ERROR),
    }
}

async fn reorder_col_songs(
    Path(collection_id): Path<i64>,
    Json(body): Json<ReorderBody>,
) -> Result<impl IntoResponse, StatusCode> {
    reorder_collection_songs(collection_id, &body.order)
        .map(|_| Json(MessageResponse { message: "Reordered" }))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Serialize)]
struct UploadResponse {
    filename: String,
}

async fn upload_background(mut multipart: Multipart) -> Result<impl IntoResponse, StatusCode> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?
    {
        let filename = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "image.png".to_string());

        let content = field
            .bytes()
            .await
            .map_err(|_| StatusCode::BAD_REQUEST)?;

        let saved = save_image(&filename, &content).map_err(|_| StatusCode::BAD_REQUEST)?;
        return Ok(Json(UploadResponse { filename: saved }));
    }
    Err(StatusCode::BAD_REQUEST)
}

async fn serve_background(Path(name): Path<String>) -> Result<Response, StatusCode> {
    let (bytes, content_type) = read_image(&name).map_err(|_| StatusCode::NOT_FOUND)?;
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(Body::from(bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn get_app_settings() -> Result<impl IntoResponse, StatusCode> {
    get_settings()
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn put_app_settings(
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, StatusCode> {
    update_settings(&body)
        .map(|_| Json(MessageResponse { message: "Saved" }))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn handle_bible_books() -> impl IntoResponse {
    match get_books() {
        Ok(books) => Json(books).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct BibleChapterPath {
    book: String,
    chapter: u32,
}

async fn handle_bible_chapter(Path(p): Path<BibleChapterPath>) -> impl IntoResponse {
    match get_chapter(&p.book, p.chapter) {
        Ok(verses) => Json(verses).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct BibleSearchQuery {
    #[serde(default)]
    q: String,
    #[serde(default = "default_bible_limit")]
    limit: u32,
}

fn default_bible_limit() -> u32 {
    50
}

async fn handle_bible_search(Query(params): Query<BibleSearchQuery>) -> impl IntoResponse {
    if params.q.trim().is_empty() {
        return Json(Vec::<SearchHit>::new()).into_response();
    }
    match search_bible(&params.q, params.limit) {
        Ok(hits) => Json(hits).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// Message library routes. /messages/status always answers (installed: false
// when there is no library); the others answer 404 when there is no library or
// no such message, so the tab checks the status first.
fn library_error(e: LibraryError) -> Response {
    let status = match e {
        LibraryError::NotInstalled | LibraryError::NotFound => StatusCode::NOT_FOUND,
        LibraryError::Invalid(_) => StatusCode::BAD_REQUEST,
        LibraryError::Sql(_) | LibraryError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, e.to_string()).into_response()
}

fn library_json<T: Serialize>(result: Result<T, LibraryError>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(e) => library_error(e),
    }
}

async fn handle_messages_status() -> Response {
    library_json(messages::library().status())
}

// The whole catalogue (every message and book chapter, without text): about
// 1,200 rows, which the tab browses and searches by title, date and date code.
async fn handle_messages_catalogue() -> Response {
    library_json(messages::library().catalogue())
}

async fn handle_message(Path(code): Path<String>) -> Response {
    library_json(messages::library().message(&code))
}

#[derive(Deserialize)]
struct MessageSearchQuery {
    #[serde(default)]
    q: String,
    /// "message", "book", or "all"/empty for both.
    kind: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    code: Option<String>,
    limit: Option<u32>,
}

async fn handle_messages_search(Query(p): Query<MessageSearchQuery>) -> Response {
    let kind = match p.kind.as_deref() {
        None | Some("") | Some("all") => None,
        Some(k @ ("message" | "book")) => Some(k.to_string()),
        Some(_) => {
            return (StatusCode::BAD_REQUEST, "kind must be message, book or all").into_response()
        }
    };
    let filter = SearchFilter {
        kind,
        year_from: p.from,
        year_to: p.to,
        code: p.code.filter(|c| !c.is_empty()),
    };
    if p.q.trim().is_empty() {
        // Still report a missing library, so the tab can show what to do.
        return library_json(messages::library().status().and_then(|s| {
            if s.installed {
                Ok(Vec::<messages::Hit>::new())
            } else {
                Err(LibraryError::NotInstalled)
            }
        }));
    }
    let limit = p.limit.unwrap_or(messages::DEFAULT_SEARCH_LIMIT);
    library_json(messages::library().search(&p.q, &filter, limit))
}

pub fn create_router() -> Router {
    // The router is mounted onto a Tauri custom URI scheme handler (see
    // tauri-plugin-axum in main.rs), so requests come straight from the
    // webview via IPC — no TCP, no CORS, no race conditions.
    Router::new()
        .route("/", get(root))
        .route("/songs", get(list_songs).post(create_new_song))
        .route("/songs/search", get(search))
        .route(
            "/songs/{song_id}",
            get(get_song_by_id)
                .put(update_existing_song)
                .delete(delete_existing_song),
        )
        .route("/songs/{song_id}/restore", post(restore_trashed_song))
        .route("/trash", get(list_trash))
        .route("/duplicates", get(list_duplicate_songs))
        .route("/backups", get(get_backups).post(create_backup_handler))
        .route("/backups/{name}/restore", post(restore_backup_handler))
        .route("/import", post(import_songs))
        .route("/import/preview", post(preview_import))
        .route("/import/selected", post(import_selected))
        .route("/songs/source", put(set_songs_source_handler))
        .route("/export", get(export_songs_handler))
        .route("/collections", get(list_collections).post(create_new_collection))
        .route(
            "/collections/{collection_id}",
            get(get_collection_by_id)
                .put(rename_existing_collection)
                .delete(delete_existing_collection),
        )
        .route("/collections/{collection_id}/songs", post(add_song_to_col))
        .route(
            "/collections/{collection_id}/songs/{entry_id}",
            delete(remove_song_from_col),
        )
        .route("/collections/{collection_id}/reorder", put(reorder_col_songs))
        .route("/settings", get(get_app_settings).put(put_app_settings))
        .route("/backgrounds", post(upload_background))
        .route("/backgrounds/{name}", get(serve_background))
        .route("/bible/books", get(handle_bible_books))
        .route("/bible/search", get(handle_bible_search))
        .route("/bible/{book}/{chapter}", get(handle_bible_chapter))
        .route("/messages", get(handle_messages_catalogue))
        .route("/messages/status", get(handle_messages_status))
        .route("/messages/search", get(handle_messages_search))
        .route("/messages/{code}", get(handle_message))
}

#[cfg(test)]
mod tests {
    use super::create_router;
    use crate::messages::test_util::{build_library, TempDir, FIRST};
    use crate::messages::{self, APPLICATION_ID, FORMAT_VERSION};
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    async fn get(path: &str) -> (StatusCode, serde_json::Value) {
        let response = create_router()
            .oneshot(Request::get(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    fn codes(hits: &serde_json::Value) -> Vec<&str> {
        hits.as_array()
            .unwrap()
            .iter()
            .map(|h| h["code"].as_str().unwrap())
            .collect()
    }

    // The only test that uses the app's own library (one per test process), so
    // it runs every check in order: nothing installed, installed, removed.
    #[tokio::test]
    async fn message_routes() {
        let lib = messages::library();
        lib.remove().unwrap();

        let (status, body) = get("/messages/status").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["installed"], false);
        for path in ["/messages", "/messages/50-0101", "/messages/search?q=river", "/messages/search?q="] {
            assert_eq!(get(path).await.0, StatusCode::NOT_FOUND, "{}", path);
        }

        let dir = TempDir::new("routes");
        let source = dir.join("source.db");
        build_library(&source, FIRST, APPLICATION_ID, FORMAT_VERSION);
        lib.import(&source, |_, _| {}).unwrap();

        let (status, body) = get("/messages/status").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["installed"], true);
        assert_eq!(body["message_count"], 2);
        assert_eq!(body["tab_label"], "The Test Tab");

        // "status" and "search" are routes of their own, not message codes.
        let (status, body) = get("/messages").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(codes(&body), vec!["BK-01", "50-0101", "60-0202E"]);

        let (status, body) = get("/messages/50-0101").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["title"], "Morning Over The Valley");
        assert_eq!(body["paragraphs"].as_array().unwrap().len(), 4);
        assert_eq!(get("/messages/99-9999").await.0, StatusCode::NOT_FOUND);

        let (status, body) = get("/messages/search?q=river%20ran%20quietly").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body.as_array().unwrap().len(), 3);
        assert_eq!(body[0]["group"], "phrase");

        let (_, body) = get("/messages/search?q=the&kind=book").await;
        assert!(codes(&body).iter().all(|c| *c == "BK-01"));
        let (_, body) = get("/messages/search?q=the&kind=all&from=1955&to=1965").await;
        assert!(!codes(&body).is_empty());
        assert!(codes(&body).iter().all(|c| *c == "60-0202E"));
        let (_, body) = get("/messages/search?q=the&code=50-0101").await;
        assert!(codes(&body).iter().all(|c| *c == "50-0101"));
        let (_, body) = get("/messages/search?q=the&limit=2").await;
        assert_eq!(body.as_array().unwrap().len(), 2);
        let (status, body) = get("/messages/search?q=%20").await;
        assert_eq!((status, body), (StatusCode::OK, serde_json::json!([])));
        assert_eq!(get("/messages/search?q=the&kind=sermon").await.0, StatusCode::BAD_REQUEST);

        lib.remove().unwrap();
        assert_eq!(get("/messages/status").await.1["installed"], false);
    }
}
