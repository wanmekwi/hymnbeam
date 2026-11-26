#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod backgrounds;
mod backup;
mod bible;
mod collections;
mod db;
mod export;
mod import;
#[cfg(target_os = "macos")]
mod macos_dock;
mod messages;
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

#[derive(serde::Serialize)]
struct ImportResult {
    imported: usize,
    song_ids: Vec<i64>,
}

// File uploads go over IPC instead of the axum custom protocol: on Windows,
// WebView2 never delivers File/Blob-backed fetch bodies to intercepted
// protocol handlers, so the multipart /import and /backgrounds endpoints
// receive empty bodies there. Those endpoints remain for the non-Tauri
// browser dev fallback.
#[tauri::command]
fn import_songs_from_content(
    filename: String,
    content: String,
    replace: Option<bool>,
) -> Result<ImportResult, String> {
    let song_ids = if replace.unwrap_or(false) {
        import::replace_library(&content, &filename)?
    } else {
        import::import_file(&content, &filename)?
    };
    Ok(ImportResult {
        imported: song_ids.len(),
        song_ids,
    })
}

// Parses another songs database file (JSON/CSV/text) and returns the songs it
// contains WITHOUT touching the library, so the operator can browse a second
// database and pick which songs to bring in. Contents come over IPC for the
// same Windows WebView2 reason as import_songs_from_content.
#[tauri::command]
fn preview_import_database(
    filename: String,
    content: String,
) -> Result<Vec<models::Song>, String> {
    import::parse_songs(&content, &filename)
}

// Imports a specific set of songs the operator selected from a previewed
// database. New songs are renumbered to the end of the library and tagged with
// the given source; exact duplicates are skipped (see import::import_selected).
#[tauri::command]
fn import_selected_songs(
    songs: Vec<models::Song>,
    source: Option<String>,
) -> Result<ImportResult, String> {
    let song_ids = import::import_selected(&songs, source.as_deref())?;
    Ok(ImportResult {
        imported: song_ids.len(),
        song_ids,
    })
}

// Batch-assigns a provenance label to existing songs. `only_untagged` limits it
// to songs that don't have a source yet. Returns how many songs changed.
#[tauri::command]
fn set_songs_source(source: Option<String>, only_untagged: Option<bool>) -> Result<usize, String> {
    songs::set_source(source.as_deref(), only_untagged.unwrap_or(false))
}

// Opens an http(s) URL in the user's default browser. Used by the
// check-for-updates flow to send the user to the release download when true
// in-place updating isn't available. Restricted to http(s) so it can never be
// coaxed into launching a local file or command.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs are allowed".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(Clone, serde::Serialize)]
struct MessageLibraryProgress {
    copied: u64,
    total: u64,
}

// Asks for a message library file with a native picker and installs it. The
// picker is opened here rather than by the page, so no file path ever comes
// from the webview, and the file (over 100 MB) is never passed through IPC.
// Async, with the copy on a blocking thread: the picker waits until it is
// closed and the copy can take a while from a USB stick, and neither may
// freeze the operator window. Progress is sent as `message-library-progress`
// events. Returns None if the operator cancels the picker.
#[tauri::command]
async fn import_message_library(
    app: tauri::AppHandle,
) -> Result<Option<messages::Status>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Import message library")
        .add_filter("Message library", &["db"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut last_sent = 0u64;
        messages::library()
            .import(&path, |copied, total| {
                // About one event per percent, plus the first and last.
                if copied == 0 || copied == total || copied - last_sent >= total / 100 {
                    last_sent = copied;
                    let _ = app.emit(
                        "message-library-progress",
                        MessageLibraryProgress { copied, total },
                    );
                }
            })
            .map(Some)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn remove_message_library() -> Result<messages::Status, String> {
    messages::library().remove().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_background_image(filename: String, data_base64: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("invalid image data: {}", e))?;
    backgrounds::save_image(&filename, &bytes)
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

// Async so this runs off the main thread. Creating a second WebView2 window
// with `build()` needs the main thread's event loop to keep pumping while the
// controller initialises; a *synchronous* command blocks that very thread,
// deadlocking on Windows — the operator window freezes and the projector never
// finishes loading projector.html (it stays on about:blank). Running the
// command on the async runtime leaves the main loop free to create the webview.
#[tauri::command]
async fn open_projector_window(app: tauri::AppHandle) -> Result<(), String> {
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

    // With only one display there is nowhere to send a separate projected
    // output: a fullscreen, borderless, always-on-top projector would land
    // directly on top of the operator, hiding it entirely with no visible way
    // back (only the Escape key closes it). That reads as a frozen/crashed app.
    // So on a single-monitor machine we open the projector as an ordinary
    // decorated, resizable, non-topmost window the operator can sit beside.
    // A genuine two-screen setup is unchanged: fullscreen on the external one.
    let single_monitor = monitor_list.len() == 1;

    let mut builder = WebviewWindowBuilder::new(
        &app,
        "projector",
        WebviewUrl::App("projector.html".into()),
    )
    .title("HymnBeam — Projector");

    builder = if single_monitor {
        // Windowed preview: half the screen width (capped), 16:9, centred.
        let win_w = (size.width as f64 * 0.5).min(960.0);
        let win_h = win_w * 9.0 / 16.0;
        let win_x = position.x as f64 + (size.width as f64 - win_w) / 2.0;
        let win_y = position.y as f64 + (size.height as f64 - win_h) / 2.0;
        builder
            .position(win_x, win_y)
            .inner_size(win_w, win_h)
            .resizable(true)
            .decorations(true)
    } else {
        builder
            .position(position.x as f64, position.y as f64)
            .inner_size(size.width as f64, size.height as f64)
            .decorations(false)
            .always_on_top(true)
    };

    let projector = builder.build().map_err(|e| e.to_string())?;

    // On Windows/Linux the app menu is attached to every window, so the
    // fullscreen projector would show a menu bar strip across the top of the
    // projected output. macOS has a single global menu bar, so nothing to hide.
    #[cfg(not(target_os = "macos"))]
    let _ = projector.hide_menu();

    if !single_monitor {
        // Re-assert the position/size on the target display before fullscreen.
        // The builder's position can be applied asynchronously by the macOS
        // window server, so without this native fullscreen may capture the
        // operator's screen instead of the target one.
        let _ = projector.set_position(tauri::PhysicalPosition::new(position.x, position.y));
        let _ = projector.set_size(tauri::PhysicalSize::new(size.width, size.height));
        // Move to the target display first, then enter fullscreen on that screen.
        let _ = projector.set_fullscreen(true);
    }

    // Notify the operator when the projector window is closed (e.g. Escape key)
    // so the operator can reset its projectorOpen state and update the button.
    //
    // On a screen of its own the projector is only ever looked at, but a new
    // window takes the keyboard, and would keep it until the operator window
    // was clicked: until then the arrow keys, Space and the rest would go
    // nowhere. So whenever it is given the keyboard (as it opens, when it has
    // gone fullscreen, or on a stray click), it hands it straight back.
    // Beside the operator on a single screen it is an ordinary window, and
    // keeps what it is given: it passes its keys on itself (projector.js).
    let app_clone = app.clone();
    projector.on_window_event(move |event| match event {
        tauri::WindowEvent::Destroyed => {
            if let Some(op) = app_clone.get_webview_window("operator") {
                let _ = op.emit("projector-closed", ());
            }
        }
        tauri::WindowEvent::Focused(true) if !single_monitor => {
            if let Some(op) = app_clone.get_webview_window("operator") {
                let _ = op.set_focus();
            }
        }
        _ => {}
    });
    if !single_monitor {
        if let Some(op) = app.get_webview_window("operator") {
            let _ = op.set_focus();
        }
    }

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

    // Startup maintenance — both are safety nets, neither may block launch.
    if let Err(e) = songs::purge_expired_deleted(30) {
        eprintln!("Trash purge failed: {}", e);
    }
    if let Err(e) = backup::auto_backup_if_due() {
        eprintln!("Automatic backup failed: {}", e);
    }

    println!("HymnBeam starting (API via axum://localhost custom protocol)");

    tauri::Builder::default()
        // Mount our axum router onto a custom URI scheme handler. The webview
        // calls fetch("axum://localhost/songs") and the request is routed
        // directly through Tauri's IPC — no TCP server, no port, no CORS.
        // This MUST be registered before .setup() so the protocol is
        // available when the webview is created.
        .plugin(tauri_plugin_axum::init(api::create_router()))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        // In-place updates: the frontend checks at launch and on demand, then
        // downloads, verifies and installs the signed payload named by
        // latest.json (see docs/plans/auto-update-setup.md). If check() fails
        // the frontend falls back to opening the release download.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Lets the frontend relaunch the app once an update has installed
        // (installDownloadedUpdate → window.__TAURI__.process.relaunch).
        .plugin(tauri_plugin_process::init())
        // Native file picker for importing the message library (used from Rust
        // only; the page gets no dialog permissions). Note the plugin replaces
        // window.alert and window.confirm in every page with versions that need
        // those permissions, and its confirm() returns a Promise: the frontend
        // must keep using its own dialogs (dialogs.js), never the browser's.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            open_projector_window,
            close_projector_window,
            send_to_projector,
            import_songs_from_content,
            preview_import_database,
            import_selected_songs,
            set_songs_source,
            save_background_image,
            open_external,
            import_message_library,
            remove_message_library
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            macos_dock::set_dock_icon(APP_ICON);

            let handle = app.handle();
            let settings_item = MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?;
            let check_update_item =
                MenuItemBuilder::with_id("check_update", "Check for Updates…").build(handle)?;

            let app_submenu = SubmenuBuilder::new(handle, "HymnBeam")
                .about(None)
                .item(&check_update_item)
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
            let import_db_item =
                MenuItemBuilder::with_id("import_database", "Import from Database…")
                    .accelerator("CmdOrCtrl+Shift+I")
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
                .item(&import_db_item)
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
            let show_logo_item = MenuItemBuilder::with_id("show_logo", "Show / Hide Logo")
                .accelerator("CmdOrCtrl+L")
                .build(handle)?;

            // Nothing else advertises the single-key operator shortcuts, so the
            // reference gets a menu entry as well as its "?" binding.
            let shortcuts_item = MenuItemBuilder::with_id("shortcuts", "Keyboard Shortcuts")
                .accelerator("CmdOrCtrl+/")
                .build(handle)?;

            let view_submenu = SubmenuBuilder::new(handle, "View")
                .item(&toggle_projector_item)
                .item(&blank_screen_item)
                .item(&show_logo_item)
                .separator()
                .item(&shortcuts_item)
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
                    "check_update" => "menu-check-update",
                    "new_song" => "menu-new-song",
                    "import_songs" => "menu-import",
                    "import_database" => "menu-import-database",
                    "export_json" => "menu-export-json",
                    "export_csv" => "menu-export-csv",
                    "export_txt" => "menu-export-txt",
                    "edit_song" => "menu-edit-song",
                    "delete_song" => "menu-delete-song",
                    "toggle_projector" => "menu-toggle-projector",
                    "blank_screen" => "menu-blank-screen",
                    "show_logo" => "menu-toggle-logo",
                    "shortcuts" => "menu-shortcuts",
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
