use rusqlite::params;
use serde_json::Value;

use crate::db::get_connection;

// The settings shape is intentionally a free-form JSON blob so the frontend
// can evolve fields (new tabs, new options) without DB migrations. Defaults
// live alongside the schema in the frontend; the backend only applies a
// minimal fallback when no row exists yet.
fn default_settings() -> Value {
    serde_json::json!({
        "typography": {
            "fontFamily": "Montserrat",
            "fontWeight": 600,
            "alignment": "center"
        },
        "background": {
            "kind": "solid",
            "color": "#000000",
            "gradient": {
                "from": "#000000",
                "to": "#1a1a2e",
                "angle": 180
            },
            "image": {
                "filename": null,
                "dim": 0.4
            }
        },
        "layout": {
            "showTitleBar": true,
            "showMetaBar": true,
            "showVerseLabel": false,
            "safeAreaPct": 5
        },
        "transition": {
            "style": "fade-up",
            "durationMs": 400
        }
    })
}

pub fn get_settings() -> Result<Value, String> {
    let conn = get_connection().map_err(|e| e.to_string())?;

    let row: Option<String> = conn
        .query_row("SELECT data FROM app_settings WHERE id = 1", [], |r| r.get(0))
        .ok();

    match row {
        Some(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        None => Ok(default_settings()),
    }
}

pub fn update_settings(value: &Value) -> Result<(), String> {
    let conn = get_connection().map_err(|e| e.to_string())?;
    let payload = serde_json::to_string(value).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO app_settings (id, data) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        params![payload],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
