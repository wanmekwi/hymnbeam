// Set the macOS Dock icon at runtime. Unbundled `cargo run` / `cargo tauri
// dev` binaries have no Info.plist, so macOS falls back to the generic "Exec"
// icon — calling NSApp.setApplicationIconImage: with the bundled .icns bytes
// makes the real icon show up in dev too. Bundled .app builds also call this;
// it just harmlessly re-sets the icon they already have from Info.plist.

use objc2::rc::Retained;
use objc2::{AnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::NSData;

pub fn set_dock_icon(icon_bytes: &'static [u8]) {
    let Some(mtm) = MainThreadMarker::new() else { return };

    let data = NSData::with_bytes(icon_bytes);
    let image: Option<Retained<NSImage>> = NSImage::initWithData(NSImage::alloc(), &data);
    let Some(image) = image else { return };

    let app = NSApplication::sharedApplication(mtm);
    unsafe { app.setApplicationIconImage(Some(&image)) };
}
