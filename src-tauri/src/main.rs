#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod collections;
mod db;
mod export;
mod import;
mod models;
mod songs;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::OnceCell;

static SERVER_PORT: OnceCell<u16> = OnceCell::const_new();

#[tauri::command]
fn get_api_port() -> u16 {
    *SERVER_PORT.get().unwrap_or(&8765)
}

#[tauri::command]
fn open_projector_window(app: tauri::AppHandle) -> Result<(), String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let monitor_list: Vec<_> = monitors.into_iter().collect();

    let (position, size) = if monitor_list.len() > 1 {
        let secondary = &monitor_list[1];
        (secondary.position().clone(), secondary.size().clone())
    } else {
        let primary = &monitor_list[0];
        (primary.position().clone(), primary.size().clone())
    };

    let _projector = WebviewWindowBuilder::new(
        &app,
        "projector",
        WebviewUrl::App("projector.html".into()),
    )
    .title("Song Rays — Projector")
    .position(position.x as f64, position.y as f64)
    .inner_size(size.width as f64, size.height as f64)
    .fullscreen(true)
    .decorations(false)
    .always_on_top(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn close_projector_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("projector") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn send_to_projector(app: tauri::AppHandle, event: String, payload: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("projector") {
        window.emit(&event, payload).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");

    let port = rt.block_on(async {
        db::set_db_path(db::init_db_path());
        db::init_db().expect("Failed to initialize database");

        let port = api::start_server().await.expect("Failed to start API server");
        SERVER_PORT.set(port).ok();
        port
    });

    println!("Song Rays API server running on http://127.0.0.1:{}", port);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_api_port,
            open_projector_window,
            close_projector_window,
            send_to_projector
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
