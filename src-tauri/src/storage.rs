use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::models::ConnectionConfig;

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn connections_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("connections.json"))
}

pub fn read_connections(app: &tauri::AppHandle) -> Result<Vec<ConnectionConfig>, String> {
    let path = connections_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let s = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

pub fn write_connections(app: &tauri::AppHandle, connections: &[ConnectionConfig]) -> Result<(), String> {
    let path = connections_path(app)?;
    ensure_parent(&path)?;
    let s = serde_json::to_string_pretty(connections).map_err(|e| e.to_string())?;
    fs::write(path, s).map_err(|e| e.to_string())
}

pub fn scripts_dir(app: &tauri::AppHandle, connection_id: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("scripts")
        .join(connection_id))
}

fn sanitize_file_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Empty script name".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid script name".into());
    }
    Ok(name.to_string())
}

pub fn list_scripts(app: &tauri::AppHandle, connection_id: &str) -> Result<Vec<crate::models::ScriptInfo>, String> {
    let dir = scripts_dir(app, connection_id)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("sql") {
            continue;
        }
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        out.push(crate::models::ScriptInfo {
            name,
            updated_at: None,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub fn read_script(app: &tauri::AppHandle, connection_id: &str, name: &str) -> Result<String, String> {
    let name = sanitize_file_name(name)?;
    let path = scripts_dir(app, connection_id)?.join(name);
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn write_script(app: &tauri::AppHandle, connection_id: &str, name: &str, content: &str) -> Result<(), String> {
    let name = sanitize_file_name(name)?;
    let dir = scripts_dir(app, connection_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    fs::write(path, content).map_err(|e| e.to_string())
}

