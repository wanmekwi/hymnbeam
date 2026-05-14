#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandChild;
#[cfg(debug_assertions)]
#[allow(dead_code)]
struct CommandChild;

#[allow(dead_code)]
struct BackendProcess(Mutex<Option<CommandChild>>);

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
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            // In production builds, launch the bundled backend sidecar.
            // In dev mode the beforeDevCommand starts it instead.
            #[cfg(not(debug_assertions))]
            {
                let sidecar = app.shell().sidecar("song-rays-backend")
                    .map_err(|e| format!("sidecar not found: {e}"))?;
                let (_rx, child) = sidecar
                    .spawn()
                    .map_err(|e| format!("failed to start backend: {e}"))?;
                app.manage(BackendProcess(Mutex::new(Some(child))));
            }
            Ok(())
        })
        .on_window_event(|_window, event| {
            // Backend process is cleaned up automatically when the managed
            // CommandChild is dropped on app exit.
            if let tauri::WindowEvent::Destroyed = event {}
        })
        .invoke_handler(tauri::generate_handler![
            open_projector_window,
            close_projector_window,
            send_to_projector
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
