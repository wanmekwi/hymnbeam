use axum::{
    body::Body,
    extract::{Multipart, Path, Query},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

use crate::collections::{
    add_song_to_collection, create_collection, delete_collection, get_all_collections,
    get_collection, remove_song_from_collection, rename_collection, reorder_collection_songs,
};
use crate::backgrounds::{read_image, save_image};
use crate::export::{export_csv, export_json, export_txt};
use crate::import::import_file;
use crate::models::Song;
use crate::settings::{get_settings, update_settings};
use crate::songs::{
    create_song, delete_song, find_song_id_by_number, get_all_songs, get_song, search_songs,
    update_song,
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
struct AddSongBody {
    song_id: i64,
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

async fn import_songs(mut multipart: Multipart) -> Result<impl IntoResponse, StatusCode> {
    while let Some(field) = multipart.next_field().await.map_err(|_| StatusCode::BAD_REQUEST)? {
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
            return Err(StatusCode::BAD_REQUEST);
        }

        let content = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;
        let content_str = String::from_utf8(content.to_vec()).map_err(|_| StatusCode::BAD_REQUEST)?;

        let song_ids = import_file(&content_str, &filename).map_err(|_| StatusCode::BAD_REQUEST)?;

        return Ok(Json(ImportResponse {
            imported: song_ids.len(),
            song_ids,
        }));
    }

    Err(StatusCode::BAD_REQUEST)
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
    Json(body): Json<AddSongBody>,
) -> Result<impl IntoResponse, StatusCode> {
    add_song_to_collection(collection_id, body.song_id)
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

pub fn create_router() -> Router {
    // The API is bound to 127.0.0.1 and only ever called from the Tauri
    // webview, so we restrict CORS to the webview's own origins (macOS uses
    // tauri://localhost, Windows uses https://tauri.localhost).
    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("tauri://localhost"),
            HeaderValue::from_static("https://tauri.localhost"),
        ])
        .allow_methods(Any)
        .allow_headers(Any);

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
        .route("/import", post(import_songs))
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
        .layer(cors)
}

pub async fn start_server() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;

    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let router = create_router();

    tokio::spawn(async move {
        axum::serve(listener, router).await.ok();
    });

    Ok(port)
}
