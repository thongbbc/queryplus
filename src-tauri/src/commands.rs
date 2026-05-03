use std::collections::HashMap;
use std::future::Future;
use std::sync::{atomic::Ordering, Arc};

use tauri::State;

use crate::db::{is_connection_error, DbPool};
use crate::models::{
    ApplyChangesInput, ApplyChangesResult, ColumnInfo, ConnectionConfig, DbType, EditableResultInfo, QueryPagination,
    QueryResult, ScriptInfo,
};
use crate::{parse, storage, AppState};

use sqlx::{
    postgres::PgRow, mysql::MySqlRow, Column, Executor, Row, Statement, ValueRef,
};

use futures_util::TryStreamExt;

use chrono::{NaiveDate, NaiveTime, NaiveDateTime, DateTime, Utc};

const MAX_SELECT_ROWS: usize = 1000;

const QUERY_TIMEOUT_SECS: u64 = 30;

fn find_connection(state: &AppState, id: &str) -> Option<ConnectionConfig> {
    state
        .connections
        .lock()
        .ok()
        .and_then(|v| v.iter().find(|c| c.id == id).cloned())
}

fn quote_ident(kind: &DbType, ident: &str) -> String {
    match kind {
        DbType::Postgres => format!("\"{}\"", ident.replace('"', "")),
        DbType::Mysql | DbType::Mariadb => format!("`{}`", ident.replace('`', "")),
    }
}

fn qualify_table(kind: &DbType, schema: Option<&str>, table: &str) -> String {
    if let Some(s) = schema {
        format!("{}.{}", quote_ident(kind, s), quote_ident(kind, table))
    } else {
        quote_ident(kind, table)
    }
}

fn json_to_opt_string(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => Some(v.to_string()),
    }
}

// ─── Type classification helpers (reusable, no hardcode per-type) ───

fn is_int_type(t: &str) -> bool {
    matches!(
        t,
        "smallint" | "integer" | "bigint" | "tinyint" | "mediumint" | "int" | "int2" | "int4" | "int8"
    ) || t.contains("int")
        || t.contains("serial")
}

fn is_float_type(t: &str) -> bool {
    matches!(t, "real" | "float" | "float4" | "float8" | "double" | "decimal" | "numeric")
        || t.contains("float")
        || t.contains("double")
        || t.contains("numeric")
        || t.contains("decimal")
}

fn is_bool_type(t: &str) -> bool {
    t == "boolean" || t == "bool" || t == "tinyint(1)"
}

fn is_json_type(t: &str) -> bool {
    t.contains("json")
}

fn is_uuid_type(t: &str) -> bool {
    t == "uuid"
}

fn is_date_type(t: &str) -> bool {
    t == "date"
}

fn is_time_type(t: &str) -> bool {
    t == "time" || t.contains("time without time zone")
}

fn is_timestamptz_type(t: &str) -> bool {
    t.contains("timestamptz") || t.contains("timestamp with time zone")
}

fn is_timestamp_type(t: &str) -> bool {
    (t.contains("timestamp") && !is_timestamptz_type(t)) || t.contains("datetime")
}

// ─── Simple typed-value extractors (non-generic, each just tries decode + String fallback) ───

fn int_to_json(v: i64) -> serde_json::Value {
    if v > 9_007_199_254_740_991_i64 || v < -9_007_199_254_740_991_i64 {
        serde_json::Value::from(v.to_string())
    } else {
        serde_json::Value::from(v)
    }
}

fn u64_to_json(v: u64) -> serde_json::Value {
    if v > 9_007_199_254_740_991_u64 {
        serde_json::Value::from(v.to_string())
    } else {
        serde_json::Value::from(v)
    }
}

fn try_get_pg_string(row: &PgRow, i: usize) -> Option<String> {
    row.try_get::<Option<String>>(i).ok().flatten()
}

fn try_get_pg_string_or_raw(row: &PgRow, i: usize) -> Option<serde_json::Value> {
    if let Some(s) = try_get_pg_string(row, i) {
        return Some(serde_json::Value::from(s));
    }
    // Last resort: decode raw bytes
    let raw = row.try_get_raw(i).ok()?;
    if raw.is_null() {
        return None;
    }
    let bytes = raw.as_bytes()?;
    String::from_utf8(bytes.to_vec()).ok().map(serde_json::Value::from)
}

fn try_get_mysql_string(row: &MySqlRow, i: usize) -> Option<String> {
    row.try_get::<Option<String>>(i).ok().flatten()
}

fn try_get_mysql_string_or_raw(row: &MySqlRow, i: usize) -> Option<serde_json::Value> {
    if let Some(s) = try_get_mysql_string(row, i) {
        return Some(serde_json::Value::from(s));
    }
    None
}

async fn run_pg_with_retries<T, Fut>(
    state: &AppState,
    config: &ConnectionConfig,
    cancel_flag: Option<Arc<std::sync::atomic::AtomicBool>>,
    mut f: impl FnMut(sqlx::PgPool) -> Fut,
) -> Result<T, String>
where
    Fut: Future<Output = Result<T, sqlx::Error>>,
{
    let mut attempt = 0u32;
    let mut backoff_ms = 250u64;
    loop {
        // Check cancel flag before each attempt
        if let Some(ref flag) = cancel_flag {
            if flag.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("Query cancelled by user".into());
            }
        }
        let pool = match state.pools.get(&config.id) {
            Some(DbPool::Postgres(p)) => p,
            _ => return Err("Not connected".into()),
        };
        match tokio::time::timeout(
            std::time::Duration::from_secs(QUERY_TIMEOUT_SECS),
            f(pool),
        )
        .await
        {
            Ok(Ok(v)) => return Ok(v),
            Ok(Err(e)) => {
                if !is_connection_error(&e) || attempt >= 3 {
                    return Err(e.to_string());
                }
                attempt += 1;
                state.pools.reconnect(config).await?;
                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(1500);
            }
            Err(_) => {
                let msg = format!("Query timed out after {} seconds", QUERY_TIMEOUT_SECS);
                if attempt >= 3 {
                    return Err(msg);
                }
                attempt += 1;
                state.pools.reconnect(config).await?;
                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(1500);
            }
        }
    }
}

async fn run_mysql_with_retries<T, Fut>(
    state: &AppState,
    config: &ConnectionConfig,
    cancel_flag: Option<Arc<std::sync::atomic::AtomicBool>>,
    mut f: impl FnMut(sqlx::MySqlPool) -> Fut,
) -> Result<T, String>
where
    Fut: Future<Output = Result<T, sqlx::Error>>,
{
    let mut attempt = 0u32;
    let mut backoff_ms = 250u64;
    loop {
        // Check cancel flag before each attempt
        if let Some(ref flag) = cancel_flag {
            if flag.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("Query cancelled by user".into());
            }
        }
        let pool = match state.pools.get(&config.id) {
            Some(DbPool::Mysql(p)) => p,
            _ => return Err("Not connected".into()),
        };
        match tokio::time::timeout(
            std::time::Duration::from_secs(QUERY_TIMEOUT_SECS),
            f(pool),
        )
        .await
        {
            Ok(Ok(v)) => return Ok(v),
            Ok(Err(e)) => {
                if !is_connection_error(&e) || attempt >= 3 {
                    return Err(e.to_string());
                }
                attempt += 1;
                state.pools.reconnect(config).await?;
                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(1500);
            }
            Err(_) => {
                let msg = format!("Query timed out after {} seconds", QUERY_TIMEOUT_SECS);
                if attempt >= 3 {
                    return Err(msg);
                }
                attempt += 1;
                state.pools.reconnect(config).await?;
                tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * 2).min(1500);
            }
        }
    }
}

#[tauri::command]
pub fn load_connections(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<ConnectionConfig>, String> {
    let conns = storage::read_connections(&app)?;
    let mut guard = state.connections.lock().map_err(|_| "poisoned".to_string())?;
    *guard = conns.clone();
    Ok(conns)
}

#[tauri::command]
pub fn save_connections(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    connections: Vec<ConnectionConfig>,
) -> Result<(), String> {
    storage::write_connections(&app, &connections)?;
    let mut guard = state.connections.lock().map_err(|_| "poisoned".to_string())?;
    *guard = connections;
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    db_type: DbType,
    host: String,
    port: u16,
    username: String,
    password: String,
    database: String,
    ssl: bool,
) -> Result<String, String> {
    let config = ConnectionConfig {
        id: "test".into(),
        name: "test".into(),
        db_type,
        host,
        port,
        username,
        password,
        database,
        ssl,
        created_at: "".into(),
        updated_at: "".into(),
    };
    let pool = crate::db::connect_pool(&config).await?;
    match pool {
        DbPool::Postgres(p) => {
            sqlx::query("SELECT 1")
                .execute(&p)
                .await
                .map_err(|e| e.to_string())?;
            Ok("Connected successfully".into())
        }
        DbPool::Mysql(p) => {
            sqlx::query("SELECT 1")
                .execute(&p)
                .await
                .map_err(|e| e.to_string())?;
            Ok("Connected successfully".into())
        }
    }
}

#[tauri::command]
pub async fn db_connect(state: State<'_, AppState>, connection_id: String) -> Result<String, String> {
    let config = find_connection(&state, &connection_id).ok_or("Connection not found")?;
    state.pools.connect(&config).await?;
    Ok(format!("Connected to {}", config.name))
}

#[tauri::command]
pub async fn list_databases(state: State<'_, AppState>, connection_id: String) -> Result<Vec<String>, String> {
    let config = find_connection(&state, &connection_id).ok_or("Connection not found")?;
    if state.pools.get(&connection_id).is_none() {
        return Err("Not connected".into());
    }
    let pool = state.pools.get(&connection_id).ok_or("Not connected")?;
    match pool {
        DbPool::Postgres(_) => {
            run_pg_with_retries(&state, &config, None, |p| async move {
                sqlx::query_scalar::<_, String>(
                    "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname",
                )
                .fetch_all(&p)
                .await
            })
            .await
        }
        DbPool::Mysql(_) => {
            run_mysql_with_retries(&state, &config, None, |p| async move {
                sqlx::query_scalar::<_, String>("SHOW DATABASES").fetch_all(&p).await
            })
            .await
        }
    }
}

#[tauri::command]
pub fn db_disconnect(state: State<'_, AppState>, connection_id: String) -> Result<(), String> {
    state.pools.remove(&connection_id);
    Ok(())
}

fn row_to_json_typed_pg(
    row: &PgRow,
    columns: &[ColumnInfo],
) -> Vec<serde_json::Value> {
    let mut out = Vec::with_capacity(columns.len());
    for (i, col) in columns.iter().enumerate() {
        let type_name = col.data_type.to_lowercase();
        let v = match type_name.as_str() {
            t if is_int_type(t) => {
                if let Ok(Some(v)) = row.try_get::<Option<i64>>(i) {
                    int_to_json(v)
                } else if let Some(s) = try_get_pg_string(row, i) {
                    serde_json::Value::from(s)
                } else {
                    serde_json::Value::Null
                }
            }
            t if is_float_type(t) => {
                if let Ok(Some(v)) = row.try_get::<Option<f64>>(i) {
                    serde_json::Value::from(v)
                } else if let Some(s) = try_get_pg_string(row, i) {
                    serde_json::Value::from(s)
                } else {
                    serde_json::Value::Null
                }
            }
            t if is_bool_type(t) => {
                row.try_get::<Option<bool>>(i)
                    .ok()
                    .flatten()
                    .map(serde_json::Value::from)
                    .or_else(|| try_get_pg_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_json_type(t) => {
                row.try_get::<Option<serde_json::Value>>(i)
                    .ok()
                    .flatten()
                    .or_else(|| try_get_pg_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_uuid_type(t) => {
                row.try_get::<Option<uuid::Uuid>>(i)
                    .ok()
                    .flatten()
                    .map(|u| serde_json::Value::from(u.to_string()))
                    .or_else(|| try_get_pg_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_date_type(t) => {
                row.try_get::<Option<NaiveDate>>(i)
                    .ok()
                    .flatten()
                    .map(|d| serde_json::Value::from(d.format("%Y-%m-%d").to_string()))
                    .or_else(|| try_get_pg_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_time_type(t) => {
                row.try_get::<Option<NaiveTime>>(i)
                    .ok()
                    .flatten()
                    .map(|t| serde_json::Value::from(t.format("%H:%M:%S").to_string()))
                    .or_else(|| try_get_pg_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_timestamptz_type(t) => {
                row.try_get::<Option<DateTime<Utc>>>(i)
                    .ok()
                    .flatten()
                    .map(|dt| serde_json::Value::from(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                    .or_else(|| {
                        row.try_get::<Option<NaiveDateTime>>(i).ok().flatten()
                            .map(|dt| serde_json::Value::from(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                    })
                    .or_else(|| try_get_pg_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_timestamp_type(t) => {
                row.try_get::<Option<NaiveDateTime>>(i)
                    .ok()
                    .flatten()
                    .map(|dt| serde_json::Value::from(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                    .or_else(|| {
                        row.try_get::<Option<DateTime<Utc>>>(i).ok().flatten()
                            .map(|dt| serde_json::Value::from(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                    })
                    .or_else(|| try_get_pg_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            _ => {
                try_get_pg_string_or_raw(row, i)
                    .unwrap_or(serde_json::Value::Null)
            }
        };
        out.push(v);
    }
    out
}

fn row_to_json_typed_mysql(
    row: &MySqlRow,
    columns: &[ColumnInfo],
) -> Vec<serde_json::Value> {
    let mut out = Vec::with_capacity(columns.len());
    for (i, col) in columns.iter().enumerate() {
        let type_name = col.data_type.to_lowercase();
        let v = match type_name.as_str() {
            t if is_int_type(t) => {
                if let Ok(Some(v)) = row.try_get::<Option<i64>>(i) {
                    int_to_json(v)
                } else if let Ok(Some(v)) = row.try_get::<Option<u64>>(i) {
                    u64_to_json(v)
                } else if let Some(s) = try_get_mysql_string(row, i) {
                    serde_json::Value::from(s)
                } else {
                    serde_json::Value::Null
                }
            }
            t if is_float_type(t) => {
                if let Ok(Some(v)) = row.try_get::<Option<f64>>(i) {
                    serde_json::Value::from(v)
                } else if let Some(s) = try_get_mysql_string(row, i) {
                    serde_json::Value::from(s)
                } else {
                    serde_json::Value::Null
                }
            }
            t if is_bool_type(t) => {
                row.try_get::<Option<bool>>(i)
                    .ok()
                    .flatten()
                    .map(serde_json::Value::from)
                    .or_else(|| try_get_mysql_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_json_type(t) => {
                row.try_get::<Option<serde_json::Value>>(i)
                    .ok()
                    .flatten()
                    .or_else(|| try_get_mysql_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_date_type(t) => {
                row.try_get::<Option<NaiveDate>>(i)
                    .ok()
                    .flatten()
                    .map(|d| serde_json::Value::from(d.format("%Y-%m-%d").to_string()))
                    .or_else(|| try_get_mysql_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_time_type(t) => {
                row.try_get::<Option<NaiveTime>>(i)
                    .ok()
                    .flatten()
                    .map(|t| serde_json::Value::from(t.format("%H:%M:%S").to_string()))
                    .or_else(|| try_get_mysql_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            t if is_timestamp_type(t) || is_timestamptz_type(t) => {
                row.try_get::<Option<NaiveDateTime>>(i)
                    .ok()
                    .flatten()
                    .map(|dt| serde_json::Value::from(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                    .or_else(|| {
                        row.try_get::<Option<DateTime<Utc>>>(i).ok().flatten()
                            .map(|dt| serde_json::Value::from(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                    })
                    .or_else(|| try_get_mysql_string(row, i).map(serde_json::Value::from))
                    .unwrap_or(serde_json::Value::Null)
            }
            _ => {
                try_get_mysql_string_or_raw(row, i)
                    .unwrap_or(serde_json::Value::Null)
            }
        };
        out.push(v);
    }
    out
}

async fn pg_enum_values(pool: &sqlx::PgPool, schema: &str, table: &str) -> Result<HashMap<String, Vec<String>>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT c.column_name, e.enumlabel
         FROM information_schema.columns c
         JOIN pg_type t ON t.typname = c.udt_name
         JOIN pg_enum e ON e.enumtypid = t.oid
         WHERE c.table_schema = $1 AND c.table_name = $2 AND c.data_type = 'USER-DEFINED'
         ORDER BY c.column_name, e.enumsortorder",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await?;
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for (col, label) in rows {
        out.entry(col).or_default().push(label);
    }
    Ok(out)
}

fn parse_mysql_enum_values(column_type: &str) -> Vec<String> {
    let s = column_type.trim();
    let lower = s.to_ascii_lowercase();
    if !lower.starts_with("enum(") || !s.ends_with(')') {
        return Vec::new();
    }
    let inner = &s[5..s.len() - 1];
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_str = false;
    let mut esc = false;
    for ch in inner.chars() {
        if !in_str {
            if ch == '\'' {
                in_str = true;
                cur.clear();
            }
            continue;
        }
        if esc {
            cur.push(ch);
            esc = false;
            continue;
        }
        if ch == '\\' {
            esc = true;
            continue;
        }
        if ch == '\'' {
            out.push(cur.clone());
            in_str = false;
            continue;
        }
        cur.push(ch);
    }
    out
}

async fn mysql_enum_values(pool: &sqlx::MySqlPool, database: &str, table: &str) -> Result<HashMap<String, Vec<String>>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT COLUMN_NAME, COLUMN_TYPE
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ? AND DATA_TYPE = 'enum'
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await?;
    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for (col, column_type) in rows {
        let vals = parse_mysql_enum_values(&column_type);
        if !vals.is_empty() {
            out.insert(col, vals);
        }
    }
    Ok(out)
}

/// Set the cancel flag for a connection. execute_query checks this and returns early.
/// Also runs pg_cancel_backend / KILL QUERY on the database server.
#[tauri::command]
pub async fn cancel_query(state: State<'_, AppState>, connection_id: String) -> Result<(), String> {
    // 1. Set the cancel flag so execute_query checks it
    if let Ok(flags) = state.cancel_flags.lock() {
        if let Some(flag) = flags.get(&connection_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    // 2. Try to kill the running query on the database server
    if let Some(pool) = state.pools.get(&connection_id) {
        match pool {
            DbPool::Postgres(p) => {
                let _ = sqlx::query(
                    "SELECT pg_cancel_backend(pid) FROM pg_stat_activity \
                     WHERE state = 'active' AND pid <> pg_backend_pid() \
                     AND query != '<IDLE>' AND usename = current_user"
                )
                .execute(&p)
                .await;
            }
            DbPool::Mysql(p) => {
                let _ = sqlx::query(
                    "SELECT GROUP_CONCAT(id) FROM information_schema.PROCESSLIST \
                     WHERE USER = CURRENT_USER() AND ID <> CONNECTION_ID() \
                     AND INFO IS NOT NULL AND COMMAND = 'Query'"
                )
                .execute(&p)
                .await;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn execute_query(state: State<'_, AppState>, connection_id: String, query: String) -> Result<QueryResult, String> {
    let config = find_connection(&state, &connection_id).ok_or("Connection not found")?;
    if state.pools.get(&connection_id).is_none() {
        return Err("Not connected. Click Connect first.".into());
    }

    // Set cancel flag for this connection
    {
        let mut flags = state.cancel_flags.lock().map_err(|_| "lock error".to_string())?;
        flags.insert(connection_id.clone(), Arc::new(std::sync::atomic::AtomicBool::new(false)));
    }

    let cancel_flag = {
        let flags = state.cancel_flags.lock().map_err(|_| "lock error".to_string())?;
        flags.get(&connection_id).cloned()
    };

    let meta = parse::parse_select(&query);
    let started = std::time::Instant::now();

    let pool = state.pools.get(&connection_id).ok_or("Not connected")?;
    let result = match pool {
        DbPool::Postgres(p) => {
            if meta.is_select {
                let rows = run_pg_with_retries(&state, &config, cancel_flag.clone(), |p| {
                    let q = query.clone();
                    async move {
                        let mut stream = sqlx::query(&q).fetch(&p);
                        let mut out = Vec::new();
                        while let Some(row) = stream.try_next().await? {
                            out.push(row);
                            if out.len() >= MAX_SELECT_ROWS {
                                break;
                            }
                        }
                        Ok(out)
                    }
                })
                .await?;
                let mut columns_info: Vec<ColumnInfo> =
                    run_pg_with_retries(&state, &config, cancel_flag.clone(), |p| {
                        let q = query.clone();
                        async move {
                            let mut conn = p.acquire().await?;
                            let stmt = conn.prepare(&q).await?;
                            Ok(stmt
                                .columns()
                                .iter()
                                .map(|c| ColumnInfo {
                                    name: c.name().to_string(),
                                    data_type: sqlx::TypeInfo::name(c.type_info()).to_string(),
                                    enum_values: None,
                                })
                                .collect::<Vec<_>>())
                        }
                    })
                    .await?;
                let rows_json = rows
                    .iter()
                    .map(|r| row_to_json_typed_pg(r, &columns_info))
                    .collect::<Vec<_>>();

                let pagination = if meta.limit.is_some() {
                    let limit = meta.limit;
                    let offset = meta.offset.unwrap_or(0);
                    Some(QueryPagination {
                        limit,
                        offset: Some(offset),
                        page_size: limit,
                        page: limit.map(|l| (offset / l) + 1),
                    })
                } else {
                    None
                };

                let editable = run_pg_with_retries(&state, &config, cancel_flag.clone(), |p| {
                    let config_ref = &config;
                    let meta_ref = &meta;
                    let columns_ref = &columns_info;
                    async move { Ok(compute_editability(&p, config_ref, meta_ref, columns_ref).await) }
                })
                .await?;

                if editable.enabled {
                    if let (Some(schema), Some(table)) = (editable.schema.as_deref(), editable.table.as_deref()) {
                        if let Ok(map) = pg_enum_values(&p, schema, table).await {
                            for c in &mut columns_info {
                                if let Some(v) = map.get(&c.name) {
                                    c.enum_values = Some(v.clone());
                                }
                            }
                        }
                    }
                }

                QueryResult {
                    columns: columns_info,
                    rows: rows_json,
                    row_count: rows.len(),
                    execution_time_ms: started.elapsed().as_millis() as u64,
                    editable: Some(editable),
                    pagination,
                    total_records: None,
                    affected_rows: None,
                }
            } else {
                let res = run_pg_with_retries(&state, &config, cancel_flag.clone(), |p| {
                    let q = query.clone();
                    async move { sqlx::query(&q).execute(&p).await }
                })
                .await?;
                QueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    row_count: 0,
                    execution_time_ms: started.elapsed().as_millis() as u64,
                    editable: None,
                    pagination: None,
                    total_records: None,
                    affected_rows: Some(res.rows_affected()),
                }
            }
        }
        DbPool::Mysql(p) => {
            if meta.is_select {
                let rows = run_mysql_with_retries(&state, &config, cancel_flag.clone(), |p| {
                    let q = query.clone();
                    async move {
                        let mut stream = sqlx::query(&q).fetch(&p);
                        let mut out = Vec::new();
                        while let Some(row) = stream.try_next().await? {
                            out.push(row);
                            if out.len() >= MAX_SELECT_ROWS {
                                break;
                            }
                        }
                        Ok(out)
                    }
                })
                .await?;
                let mut columns_info: Vec<ColumnInfo> = if let Some(r0) = rows.get(0) {
                    r0.columns()
                        .iter()
                        .map(|c| ColumnInfo {
                            name: c.name().to_string(),
                            data_type: sqlx::TypeInfo::name(c.type_info()).to_string(),
                            enum_values: None,
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                let rows_json = rows
                    .iter()
                    .map(|r| row_to_json_typed_mysql(r, &columns_info))
                    .collect::<Vec<_>>();

                let pagination = if meta.limit.is_some() {
                    let limit = meta.limit;
                    let offset = meta.offset.unwrap_or(0);
                    Some(QueryPagination {
                        limit,
                        offset: Some(offset),
                        page_size: limit,
                        page: limit.map(|l| (offset / l) + 1),
                    })
                } else {
                    None
                };

                let editable = run_mysql_with_retries(&state, &config, cancel_flag.clone(), |p| {
                    let config_ref = &config;
                    let meta_ref = &meta;
                    let columns_ref = &columns_info;
                    async move { Ok(compute_editability_mysql(&p, config_ref, meta_ref, columns_ref).await) }
                })
                .await?;

                if editable.enabled {
                    let db = editable.schema.clone().unwrap_or_else(|| editable.database.clone());
                    if let Some(table) = editable.table.as_deref() {
                        if let Ok(map) = mysql_enum_values(&p, &db, table).await {
                            for c in &mut columns_info {
                                if let Some(v) = map.get(&c.name) {
                                    c.enum_values = Some(v.clone());
                                }
                            }
                        }
                    }
                }

                QueryResult {
                    columns: columns_info,
                    rows: rows_json,
                    row_count: rows.len(),
                    execution_time_ms: started.elapsed().as_millis() as u64,
                    editable: Some(editable),
                    pagination,
                    total_records: None,
                    affected_rows: None,
                }
            } else {
                let res = run_mysql_with_retries(&state, &config, cancel_flag.clone(), |p| {
                    let q = query.clone();
                    async move { sqlx::query(&q).execute(&p).await }
                })
                .await?;
                QueryResult {
                    columns: Vec::new(),
                    rows: Vec::new(),
                    row_count: 0,
                    execution_time_ms: started.elapsed().as_millis() as u64,
                    editable: None,
                    pagination: None,
                    total_records: None,
                    affected_rows: Some(res.rows_affected()),
                }
            }
        }
    };

    // Cleanup: remove cancel flag entry for this connection
    if let Ok(mut flags) = state.cancel_flags.lock() {
        flags.remove(&connection_id);
    }

    Ok(result)
}

async fn compute_editability(
    pool: &sqlx::PgPool,
    config: &ConnectionConfig,
    meta: &parse::SelectMeta,
    columns: &[ColumnInfo],
) -> EditableResultInfo {
    let database = if config.database.trim().is_empty() {
        "postgres".to_string()
    } else {
        config.database.clone()
    };
    let mut editable = EditableResultInfo {
        enabled: false,
        reason_disabled: None,
        database,
        schema: meta.schema.clone(),
        table: meta.table.clone(),
        primary_key_columns: None,
    };

    if !meta.is_select || !meta.is_simple {
        editable.reason_disabled = Some("Query is not a simple SELECT".into());
        return editable;
    }

    let table = match &meta.table {
        Some(t) => t,
        None => {
            editable.reason_disabled = Some("Cannot detect table".into());
            return editable;
        }
    };
    let schema = if let Some(s) = meta.schema.clone() {
        s
    } else {
        resolve_schema_pg(pool, table)
            .await
            .unwrap_or_else(|| "public".into())
    };
    editable.schema = Some(schema.clone());

    match primary_key_pg(pool, &schema, table).await {
        Ok(pk) => {
            if pk.is_empty() {
                editable.reason_disabled = Some("Table has no primary key".into());
                return editable;
            }
            let colnames: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
            if !pk.iter().all(|c| colnames.contains(c)) {
                editable.reason_disabled = Some("Primary key columns are not present in result".into());
                return editable;
            }
            editable.enabled = true;
            editable.primary_key_columns = Some(pk);
        }
        Err(e) => {
            editable.reason_disabled = Some(format!("Failed to read primary key: {}", e));
        }
    }

    editable
}

async fn compute_editability_mysql(
    pool: &sqlx::MySqlPool,
    config: &ConnectionConfig,
    meta: &parse::SelectMeta,
    columns: &[ColumnInfo],
) -> EditableResultInfo {
    let database = if config.database.trim().is_empty() {
        "information_schema".to_string()
    } else {
        config.database.clone()
    };
    let mut editable = EditableResultInfo {
        enabled: false,
        reason_disabled: None,
        database: database.clone(),
        schema: meta.schema.clone(),
        table: meta.table.clone(),
        primary_key_columns: None,
    };

    if !meta.is_select || !meta.is_simple {
        editable.reason_disabled = Some("Query is not a simple SELECT".into());
        return editable;
    }

    let table = match &meta.table {
        Some(t) => t,
        None => {
            editable.reason_disabled = Some("Cannot detect table".into());
            return editable;
        }
    };

    let schema = meta.schema.clone().unwrap_or_else(|| database);

    if let Ok(pk) = primary_key_mysql(pool, &schema, table).await {
        if pk.is_empty() {
            editable.reason_disabled = Some("Table has no primary key".into());
            return editable;
        }
        let colnames: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
        if !pk.iter().all(|c| colnames.contains(c)) {
            editable.reason_disabled = Some("Primary key columns are not present in result".into());
            return editable;
        }
        editable.enabled = true;
        editable.primary_key_columns = Some(pk);
    }

    editable
}

async fn primary_key_pg(pool: &sqlx::PgPool, schema: &str, table: &str) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT kcu.column_name\n         FROM information_schema.table_constraints tc\n         JOIN information_schema.key_column_usage kcu\n           ON tc.constraint_name = kcu.constraint_name\n          AND tc.table_schema = kcu.table_schema\n        WHERE tc.constraint_type = 'PRIMARY KEY'\n          AND tc.table_schema = $1\n          AND tc.table_name = $2\n        ORDER BY kcu.ordinal_position",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
}

async fn resolve_schema_pg(pool: &sqlx::PgPool, table: &str) -> Option<String> {
    let q = "SELECT n.nspname
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.oid = to_regclass($1)";
    sqlx::query_scalar::<_, String>(q).bind(table).fetch_optional(pool).await.ok().flatten()
}

async fn primary_key_mysql(pool: &sqlx::MySqlPool, schema: &str, table: &str) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT kcu.column_name\n         FROM information_schema.table_constraints tc\n         JOIN information_schema.key_column_usage kcu\n           ON tc.constraint_name = kcu.constraint_name\n          AND tc.table_schema = kcu.table_schema\n          AND tc.table_name = kcu.table_name\n        WHERE tc.constraint_type = 'PRIMARY KEY'\n          AND tc.table_schema = ?\n          AND tc.table_name = ?\n        ORDER BY kcu.ordinal_position",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
}

#[tauri::command]
pub async fn get_primary_key(state: State<'_, AppState>, connection_id: String, database: String, table: String) -> Result<Vec<String>, String> {
    find_connection(&state, &connection_id).ok_or("Connection not found")?;
    if state.pools.get(&connection_id).is_none() {
        return Err("Not connected".into());
    }
    let pool = state.pools.get(&connection_id).ok_or("Not connected")?;
    match pool {
        DbPool::Postgres(p) => primary_key_pg(&p, "public", &table).await.map_err(|e| e.to_string()),
        DbPool::Mysql(p) => primary_key_mysql(&p, &database, &table).await.map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub async fn apply_changes(state: State<'_, AppState>, input: ApplyChangesInput) -> Result<ApplyChangesResult, String> {
    let config = find_connection(&state, &input.connection_id).ok_or("Connection not found")?;
    if state.pools.get(&input.connection_id).is_none() {
        return Err("Not connected".into());
    }
    let pool = state.pools.get(&input.connection_id).ok_or("Not connected")?;

    match pool {
        DbPool::Postgres(_) => {
            let schema = input.schema.clone().unwrap_or_else(|| "public".into());
            let table = qualify_table(&DbType::Postgres, Some(&schema), &input.table);
            let inserted = run_pg_with_retries(&state, &config, None, |p| {
                let table = &table;
                let inserts = &input.inserts;
                let updates = &input.updates;
                let deletes = &input.deletes;
                let primary_key_columns = &input.primary_key_columns;
                async move {
                    let mut tx = p.begin().await?;
                    let mut inserted_count = 0u64;
                    let mut updated_count = 0u64;
                    let mut deleted_count = 0u64;

                for ins in inserts {
                    if ins.values.is_empty() {
                        continue;
                    }
                    let cols: Vec<String> = ins.values.keys().cloned().collect();
                    let mut sql = format!(
                        "INSERT INTO {} ({}) VALUES ({})",
                        table,
                        cols.iter().map(|c| quote_ident(&DbType::Postgres, c)).collect::<Vec<_>>().join(", "),
                        (1..=cols.len()).map(|i| format!("${}", i)).collect::<Vec<_>>().join(", ")
                    );
                    sql.push(';');
                    let mut q = sqlx::query(&sql);
                    for c in &cols {
                        let v = ins.values.get(c).unwrap();
                        q = q.bind(json_to_opt_string(v));
                    }
                    let res = q.execute(&mut *tx).await?;
                    inserted_count += res.rows_affected();
                }

                for upd in updates {
                    if upd.set.is_empty() {
                        continue;
                    }
                    let set_cols: Vec<String> = upd.set.keys().cloned().collect();
                    let mut idx = 1usize;
                    let set_sql = set_cols
                        .iter()
                        .map(|c| {
                            let s = format!("{} = ${}", quote_ident(&DbType::Postgres, c), idx);
                            idx += 1;
                            s
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    let where_sql = primary_key_columns
                        .iter()
                        .map(|c| {
                            let s = format!("{} = ${}", quote_ident(&DbType::Postgres, c), idx);
                            idx += 1;
                            s
                        })
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    let sql = format!("UPDATE {} SET {} WHERE {}", table, set_sql, where_sql);
                    let mut q = sqlx::query(&sql);
                    for c in &set_cols {
                        q = q.bind(json_to_opt_string(upd.set.get(c).unwrap()));
                    }
                    for v in &upd.key {
                        q = q.bind(json_to_opt_string(v));
                    }
                    let res = q.execute(&mut *tx).await?;
                    updated_count += res.rows_affected();
                }

                for del in deletes {
                    let mut idx = 1usize;
                    let where_sql = primary_key_columns
                        .iter()
                        .map(|c| {
                            let s = format!("{} = ${}", quote_ident(&DbType::Postgres, c), idx);
                            idx += 1;
                            s
                        })
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    let sql = format!("DELETE FROM {} WHERE {}", table, where_sql);
                    let mut q = sqlx::query(&sql);
                    for v in &del.key {
                        q = q.bind(json_to_opt_string(v));
                    }
                    let res = q.execute(&mut *tx).await?;
                    deleted_count += res.rows_affected();
                }

                    tx.commit().await?;
                    Ok((inserted_count, updated_count, deleted_count))
                }
            })
            .await?;
            if !input.updates.is_empty() && inserted.1 == 0 {
                return Err(format!(
                    "UPDATE affected 0 rows. Check table/schema detection (target: {}.{}).",
                    schema, input.table
                ));
            }
            if !input.deletes.is_empty() && inserted.2 == 0 {
                return Err(format!(
                    "DELETE affected 0 rows. Check table/schema detection (target: {}.{}).",
                    schema, input.table
                ));
            }

            Ok(ApplyChangesResult {
                inserted_count: inserted.0,
                updated_count: inserted.1,
                deleted_count: inserted.2,
            })
        }
        DbPool::Mysql(_) => {
            let schema = input.schema.clone().unwrap_or_else(|| input.database.clone());
            let table = qualify_table(&DbType::Mysql, Some(&schema), &input.table);
            let inserted = run_mysql_with_retries(&state, &config, None, |p| {
                let table = &table;
                let inserts = &input.inserts;
                let updates = &input.updates;
                let deletes = &input.deletes;
                let primary_key_columns = &input.primary_key_columns;
                async move {
                    let mut tx = p.begin().await?;
                    let mut inserted_count = 0u64;
                    let mut updated_count = 0u64;
                    let mut deleted_count = 0u64;

                for ins in inserts {
                    if ins.values.is_empty() {
                        continue;
                    }
                    let cols: Vec<String> = ins.values.keys().cloned().collect();
                    let sql = format!(
                        "INSERT INTO {} ({}) VALUES ({})",
                        table,
                        cols.iter().map(|c| quote_ident(&DbType::Mysql, c)).collect::<Vec<_>>().join(", "),
                        (0..cols.len()).map(|_| "?".to_string()).collect::<Vec<_>>().join(", ")
                    );
                    let mut q = sqlx::query(&sql);
                    for c in &cols {
                        let v = ins.values.get(c).unwrap();
                        q = q.bind(json_to_opt_string(v));
                    }
                    let res = q.execute(&mut *tx).await?;
                    inserted_count += res.rows_affected();
                }

                for upd in updates {
                    if upd.set.is_empty() {
                        continue;
                    }
                    let set_cols: Vec<String> = upd.set.keys().cloned().collect();
                    let set_sql = set_cols
                        .iter()
                        .map(|c| format!("{} = ?", quote_ident(&DbType::Mysql, c)))
                        .collect::<Vec<_>>()
                        .join(", ");
                    let where_sql = primary_key_columns
                        .iter()
                        .map(|c| format!("{} = ?", quote_ident(&DbType::Mysql, c)))
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    let sql = format!("UPDATE {} SET {} WHERE {}", table, set_sql, where_sql);
                    let mut q = sqlx::query(&sql);
                    for c in &set_cols {
                        q = q.bind(json_to_opt_string(upd.set.get(c).unwrap()));
                    }
                    for v in &upd.key {
                        q = q.bind(json_to_opt_string(v));
                    }
                    let res = q.execute(&mut *tx).await?;
                    updated_count += res.rows_affected();
                }

                for del in deletes {
                    let where_sql = primary_key_columns
                        .iter()
                        .map(|c| format!("{} = ?", quote_ident(&DbType::Mysql, c)))
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    let sql = format!("DELETE FROM {} WHERE {}", table, where_sql);
                    let mut q = sqlx::query(&sql);
                    for v in &del.key {
                        q = q.bind(json_to_opt_string(v));
                    }
                    let res = q.execute(&mut *tx).await?;
                    deleted_count += res.rows_affected();
                }

                    tx.commit().await?;
                    Ok((inserted_count, updated_count, deleted_count))
                }
            })
            .await?;
            if !input.updates.is_empty() && inserted.1 == 0 {
                return Err(format!(
                    "UPDATE affected 0 rows. Check table/schema detection (target: {}.{}).",
                    schema, input.table
                ));
            }
            if !input.deletes.is_empty() && inserted.2 == 0 {
                return Err(format!(
                    "DELETE affected 0 rows. Check table/schema detection (target: {}.{}).",
                    schema, input.table
                ));
            }

            Ok(ApplyChangesResult {
                inserted_count: inserted.0,
                updated_count: inserted.1,
                deleted_count: inserted.2,
            })
        }
    }
}

#[tauri::command]
pub fn list_scripts(app: tauri::AppHandle, connection_id: String) -> Result<Vec<ScriptInfo>, String> {
    storage::list_scripts(&app, &connection_id)
}

#[tauri::command]
pub fn load_script(app: tauri::AppHandle, connection_id: String, name: String) -> Result<String, String> {
    storage::read_script(&app, &connection_id, &name)
}

#[tauri::command]
pub fn save_script(app: tauri::AppHandle, connection_id: String, name: String, content: String) -> Result<(), String> {
    storage::write_script(&app, &connection_id, &name, &content)
}

#[tauri::command]
pub fn delete_script(app: tauri::AppHandle, connection_id: String, name: String) -> Result<(), String> {
    storage::delete_script(&app, &connection_id, &name)
}
