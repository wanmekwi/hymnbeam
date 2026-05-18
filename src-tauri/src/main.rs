#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod backgrounds;
mod bible;
mod collections;
mod db;
mod export;
mod import;
#[cfg(target_os = "macos")]
mod macos_dock;
mod models;
mod settings;
mod songs;

#[cfg(target_os = "macos")]
const APP_ICON: &[u8] = include_bytes!("../icons/icon.icns");

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

fn monitors_match(a: &tauri::Monitor, b: &tauri::Monitor) -> bool {
    if let (Some(na), Some(nb)) = (a.name(), b.name()) {
        if na == nb {
            return true;
        }
    }
    let pa = a.position();
    let pb = b.position();
    let sa = a.size();
    let sb = b.size();
    pa.x == pb.x && pa.y == pb.y && sa.width == sb.width && sa.height == sb.height
}

fn pick_projector_monitor<'a>(
    monitors: &'a [tauri::Monitor],
    operator: Option<&tauri::Monitor>,
    primary: Option<&tauri::Monitor>,
) -> &'a tauri::Monitor {
    if monitors.len() == 1 {
        return &monitors[0];
    }

    // Prefer any display that is not the operator window's current monitor.
    if let Some(op) = operator {
        if let Some(ext) = monitors.iter().find(|m| !monitors_match(m, op)) {
            return ext;
        }
    }

    // If we cannot detect the operator display, send output to the non-primary
    // monitor (typical external projector / HDMI setup).
    if let Some(prim) = primary {
        if let Some(ext) = monitors.iter().find(|m| !monitors_match(m, prim)) {
            return ext;
        }
    }

    // Last resort: largest display.
    monitors
        .iter()
        .max_by_key(|m| {
            let s = m.size();
            s.width * s.height
        })
        .unwrap_or(&monitors[0])
}

#[tauri::command]
fn open_projector_window(app: tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window("projector").is_some() {
        return Ok(());
    }

    let monitor_list = app.available_monitors().map_err(|e| e.to_string())?;
    if monitor_list.is_empty() {
        return Err("No monitors available".to_string());
    }

    let operator_monitor = app
        .get_webview_window("operator")
        .and_then(|w| w.current_monitor().ok().flatten());
    let primary_monitor = app.primary_monitor().ok().flatten();

    let target = pick_projector_monitor(
        &monitor_list,
        operator_monitor.as_ref(),
        primary_monitor.as_ref(),
    );

    let position = target.position();
    let size = target.size();

    let projector = WebviewWindowBuilder::new(
        &app,
        "projector",
        WebviewUrl::App("projector.html".into()),
    )
    .title("HymnBeam — Projector")
    .position(position.x as f64, position.y as f64)
    .inner_size(size.width as f64, size.height as f64)
    .decorations(false)
    .always_on_top(true)
    .build()
    .map_err(|e| e.to_string())?;

    // Move to the target display first, then enter fullscreen on that screen.
    let _ = projector.set_fullscreen(true);

    // Notify the operator when the projector window is closed (e.g. Escape key)
    // so the operator can reset its projectorOpen state and update the button.
    let app_clone = app.clone();
    projector.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Some(op) = app_clone.get_webview_window("operator") {
                let _ = op.emit("projector-closed", ());
            }
        }
    });

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
    db::set_db_path(db::init_db_path());
    db::init_db().expect("Failed to initialize database");

    println!("HymnBeam starting (API via axum://localhost custom protocol)");

    tauri::Builder::default()
        // Mount our axum router onto a custom URI scheme handler. The webview
        // calls fetch("axum://localhost/songs") and the request is routed
        // directly through Tauri's IPC — no TCP server, no port, no CORS.
        // This MUST be registered before .setup() so the protocol is
        // available when the webview is created.
        .plugin(tauri_plugin_axum::init(api::create_router()))
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            open_projector_window,
            close_projector_window,
            send_to_projector
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            macos_dock::set_dock_icon(APP_ICON);

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
