#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod backgrounds;
mod collections;
mod db;
mod export;
mod import;
mod models;
mod settings;
mod songs;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::OnceCell;

static SERVER_PORT: OnceCell<u16> = OnceCell::const_new();

#[tauri::command]
fn get_api_port() -> u16 {
    *SERVER_PORT.get().unwrap_or(&8765)
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
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
    .title("HymnBeam — Projector")
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

    println!("HymnBeam API server running on http://127.0.0.1:{}", port);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_api_port,
            get_app_version,
            open_projector_window,
            close_projector_window,
            send_to_projector
        ])
        .setup(|app| {
            let handle = app.handle();
            let settings_item = MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?;

            let app_submenu = SubmenuBuilder::new(handle, "HymnBeam")
                .about(None)
                .separator()
                .item(&settings_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let new_song_item = MenuItemBuilder::with_id("new_song", "New Song")
                .accelerator("CmdOrCtrl+N")
                .build(handle)?;
            let import_item = MenuItemBuilder::with_id("import_songs", "Import Songs…")
                .accelerator("CmdOrCtrl+I")
                .build(handle)?;

            let export_json = MenuItemBuilder::with_id("export_json", "Export as JSON…").build(handle)?;
            let export_csv = MenuItemBuilder::with_id("export_csv", "Export as CSV…").build(handle)?;
            let export_txt = MenuItemBuilder::with_id("export_txt", "Export as Plain Text…").build(handle)?;
            let export_submenu = SubmenuBuilder::new(handle, "Export Library")
                .items(&[&export_json, &export_csv, &export_txt])
                .build()?;

            let file_submenu = SubmenuBuilder::new(handle, "File")
                .item(&new_song_item)
                .item(&import_item)
                .separator()
                .item(&export_submenu)
                .separator()
                .close_window()
                .build()?;

            let edit_song_item = MenuItemBuilder::with_id("edit_song", "Edit Song…")
                .accelerator("CmdOrCtrl+E")
                .build(handle)?;
            let delete_song_item = MenuItemBuilder::with_id("delete_song", "Delete Song")
                .accelerator("CmdOrCtrl+Backspace")
                .build(handle)?;

            let edit_submenu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .separator()
                .item(&edit_song_item)
                .item(&delete_song_item)
                .build()?;

            let toggle_projector_item = MenuItemBuilder::with_id("toggle_projector", "Open / Close Projector")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(handle)?;
            let blank_screen_item = MenuItemBuilder::with_id("blank_screen", "Blank Screen")
                .accelerator("CmdOrCtrl+B")
                .build(handle)?;

            let view_submenu = SubmenuBuilder::new(handle, "View")
                .item(&toggle_projector_item)
                .item(&blank_screen_item)
                .build()?;

            let window_submenu = SubmenuBuilder::new(handle, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(handle)
                .items(&[
                    &app_submenu,
                    &file_submenu,
                    &edit_submenu,
                    &view_submenu,
                    &window_submenu,
                ])
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                let action = match id {
                    "settings" => "open-settings",
                    "new_song" => "menu-new-song",
                    "import_songs" => "menu-import",
                    "export_json" => "menu-export-json",
                    "export_csv" => "menu-export-csv",
                    "export_txt" => "menu-export-txt",
                    "edit_song" => "menu-edit-song",
                    "delete_song" => "menu-delete-song",
                    "toggle_projector" => "menu-toggle-projector",
                    "blank_screen" => "menu-blank-screen",
                    _ => return,
                };
                if let Some(window) = app.get_webview_window("operator") {
                    let _ = window.emit(action, ());
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
