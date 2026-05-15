use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn backgrounds_dir() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("HymnBeam")
        .join("backgrounds");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn sanitize_stem(name: &str) -> String {
    let stem: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let trimmed = stem.trim_matches('-');
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed.chars().take(40).collect()
    }
}

pub fn save_image(original_name: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = std::path::Path::new(original_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let allowed = ["png", "jpg", "jpeg", "webp", "gif"];
    if !allowed.contains(&ext.as_str()) {
        return Err("unsupported image extension".into());
    }

    let stem = std::path::Path::new(original_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let safe_stem = sanitize_stem(stem);

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let filename = format!("{}-{}.{}", ts, safe_stem, ext);
    let path = backgrounds_dir().join(&filename);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(filename)
}

pub fn read_image(name: &str) -> Result<(Vec<u8>, &'static str), String> {
    // Reject any path component — only flat filenames in the dir.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid name".into());
    }

    let path = backgrounds_dir().join(name);
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;

    let ext = std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let content_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    };

    Ok((bytes, content_type))
}
