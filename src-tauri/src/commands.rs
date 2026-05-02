use tauri::State;

use crate::db::{is_connection_error, DbPool};
use crate::models::{
    ApplyChangesInput, ApplyChangesResult, ColumnInfo, ConnectionConfig, DbType, EditableResultInfo, QueryPagination,
    QueryResult, ScriptInfo,
};
use crate::{parse, storage, AppState};

use sqlx::{Column, Row};

use futures_util::TryStreamExt;

const MAX_SELECT_ROWS: usize = 1000;

use std::future::Future;

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

async fn run_pg_with_retries<T, Fut>(
    state: &AppState,
    config: &ConnectionConfig,
    mut f: impl FnMut(sqlx::PgPool) -> Fut,
) -> Result<T, String>
where
    Fut: Future<Output = Result<T, sqlx::Error>>,
{
    let mut attempt = 0u32;
    let mut backoff_ms = 250u64;
    loop {
        let pool = match state.pools.get(&config.id) {
            Some(DbPool::Postgres(p)) => p,
            _ => return Err("Not connected".into()),
        };
        match f(pool).await {
            Ok(v) => return Ok(v),
            Err(e) => {
                if !is_connection_error(&e) || attempt >= 3 {
                    return Err(e.to_string());
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
    mut f: impl FnMut(sqlx::MySqlPool) -> Fut,
) -> Result<T, String>
where
    Fut: Future<Output = Result<T, sqlx::Error>>,
{
    let mut attempt = 0u32;
    let mut backoff_ms = 250u64;
    loop {
        let pool = match state.pools.get(&config.id) {
            Some(DbPool::Mysql(p)) => p,
            _ => return Err("Not connected".into()),
        };
        match f(pool).await {
            Ok(v) => return Ok(v),
            Err(e) => {
                if !is_connection_error(&e) || attempt >= 3 {
                    return Err(e.to_string());
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
            run_pg_with_retries(&state, &config, |p| async move {
                sqlx::query_scalar::<_, String>(
                    "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname",
                )
                .fetch_all(&p)
                .await
            })
            .await
        }
        DbPool::Mysql(_) => {
            run_mysql_with_retries(&state, &config, |p| async move {
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

fn row_to_json_pg(row: &sqlx::postgres::PgRow, columns: &[String]) -> Vec<serde_json::Value> {
    let mut out = Vec::with_capacity(columns.len());
    for i in 0..columns.len() {
        let v = row
            .try_get::<Option<i64>, _>(i)
            .map(|x| x.map(serde_json::Value::from))
            .or_else(|_| row.try_get::<Option<f64>, _>(i).map(|x| x.map(serde_json::Value::from)))
            .or_else(|_| row.try_get::<Option<bool>, _>(i).map(|x| x.map(serde_json::Value::from)))
            .or_else(|_| row.try_get::<Option<String>, _>(i).map(|x| x.map(serde_json::Value::from)))
            .unwrap_or(None)
            .unwrap_or(serde_json::Value::Null);
        out.push(v);
    }
    out
}

fn row_to_json_mysql(row: &sqlx::mysql::MySqlRow, columns: &[String]) -> Vec<serde_json::Value> {
    let mut out = Vec::with_capacity(columns.len());
    for i in 0..columns.len() {
        let v = row
            .try_get::<Option<i64>, _>(i)
            .map(|x| x.map(serde_json::Value::from))
            .or_else(|_| row.try_get::<Option<f64>, _>(i).map(|x| x.map(serde_json::Value::from)))
            .or_else(|_| row.try_get::<Option<bool>, _>(i).map(|x| x.map(serde_json::Value::from)))
            .or_else(|_| row.try_get::<Option<String>, _>(i).map(|x| x.map(serde_json::Value::from)))
            .unwrap_or(None)
            .unwrap_or(serde_json::Value::Null);
        out.push(v);
    }
    out
}

#[tauri::command]
pub async fn execute_query(state: State<'_, AppState>, connection_id: String, query: String) -> Result<QueryResult, String> {
    let config = find_connection(&state, &connection_id).ok_or("Connection not found")?;
    if state.pools.get(&connection_id).is_none() {
        return Err("Not connected. Click Connect first.".into());
    }

    let meta = parse::parse_select(&query);
    let started = std::time::Instant::now();

    let pool = state.pools.get(&connection_id).ok_or("Not connected")?;
    let out = match pool {
        DbPool::Postgres(_) => {
            if meta.is_select {
                let rows = run_pg_with_retries(&state, &config, |p| {
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
                let cols: Vec<String> = rows
                    .get(0)
                    .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
                    .unwrap_or_else(Vec::new);
                let columns_info: Vec<ColumnInfo> = if let Some(r0) = rows.get(0) {
                    r0.columns()
                        .iter()
                        .map(|c| ColumnInfo {
                            name: c.name().to_string(),
                            data_type: sqlx::TypeInfo::name(c.type_info()).to_string(),
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                let rows_json = rows
                    .iter()
                    .map(|r| row_to_json_pg(r, &cols))
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

                let (editable, total_records) = run_pg_with_retries(&state, &config, |p| {
                    let config_ref = &config;
                    let meta_ref = &meta;
                    let columns_ref = &columns_info;
                    async move { Ok(compute_editability_and_total(&p, config_ref, meta_ref, columns_ref).await) }
                })
                .await?;

                QueryResult {
                    columns: columns_info,
                    rows: rows_json,
                    row_count: rows.len(),
                    execution_time_ms: started.elapsed().as_millis() as u64,
                    editable: Some(editable),
                    pagination,
                    total_records,
                    affected_rows: None,
                }
            } else {
                let res = run_pg_with_retries(&state, &config, |p| {
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
        DbPool::Mysql(_) => {
            if meta.is_select {
                let rows = run_mysql_with_retries(&state, &config, |p| {
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
                let cols: Vec<String> = rows
                    .get(0)
                    .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
                    .unwrap_or_else(Vec::new);
                let columns_info: Vec<ColumnInfo> = if let Some(r0) = rows.get(0) {
                    r0.columns()
                        .iter()
                        .map(|c| ColumnInfo {
                            name: c.name().to_string(),
                            data_type: sqlx::TypeInfo::name(c.type_info()).to_string(),
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                let rows_json = rows
                    .iter()
                    .map(|r| row_to_json_mysql(r, &cols))
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

                let (editable, total_records) = run_mysql_with_retries(&state, &config, |p| {
                    let config_ref = &config;
                    let meta_ref = &meta;
                    let columns_ref = &columns_info;
                    async move { Ok(compute_editability_and_total_mysql(&p, config_ref, meta_ref, columns_ref).await) }
                })
                .await?;

                QueryResult {
                    columns: columns_info,
                    rows: rows_json,
                    row_count: rows.len(),
                    execution_time_ms: started.elapsed().as_millis() as u64,
                    editable: Some(editable),
                    pagination,
                    total_records,
                    affected_rows: None,
                }
            } else {
                let res = run_mysql_with_retries(&state, &config, |p| {
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

    Ok(out)
}

async fn compute_editability_and_total(
    pool: &sqlx::PgPool,
    config: &ConnectionConfig,
    meta: &parse::SelectMeta,
    columns: &[ColumnInfo],
) -> (EditableResultInfo, Option<u64>) {
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

    let mut total_records = None;

    if !meta.is_select || !meta.is_simple {
        editable.reason_disabled = Some("Query is not a simple SELECT".into());
        return (editable, total_records);
    }

    let table = match &meta.table {
        Some(t) => t,
        None => {
            editable.reason_disabled = Some("Cannot detect table".into());
            return (editable, total_records);
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

    if let Ok(pk) = primary_key_pg(pool, &schema, table).await {
        if pk.is_empty() {
            editable.reason_disabled = Some("Table has no primary key".into());
            return (editable, total_records);
        }
        let colnames: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
        if !pk.iter().all(|c| colnames.contains(c)) {
            editable.reason_disabled = Some("Primary key columns are not present in result".into());
            return (editable, total_records);
        }
        editable.enabled = true;
        editable.primary_key_columns = Some(pk);
    }

    let count_sql = format!(
        "SELECT COUNT(*)::bigint AS count FROM {}",
        qualify_table(&DbType::Postgres, Some(&schema), table)
    );
    if let Ok(row) = sqlx::query_scalar::<_, i64>(&count_sql).fetch_one(pool).await {
        if row >= 0 {
            total_records = Some(row as u64);
        }
    }

    (editable, total_records)
}

async fn compute_editability_and_total_mysql(
    pool: &sqlx::MySqlPool,
    config: &ConnectionConfig,
    meta: &parse::SelectMeta,
    columns: &[ColumnInfo],
) -> (EditableResultInfo, Option<u64>) {
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

    let mut total_records = None;

    if !meta.is_select || !meta.is_simple {
        editable.reason_disabled = Some("Query is not a simple SELECT".into());
        return (editable, total_records);
    }

    let table = match &meta.table {
        Some(t) => t,
        None => {
            editable.reason_disabled = Some("Cannot detect table".into());
            return (editable, total_records);
        }
    };

    let schema = meta.schema.clone().unwrap_or_else(|| database);

    if let Ok(pk) = primary_key_mysql(pool, &schema, table).await {
        if pk.is_empty() {
            editable.reason_disabled = Some("Table has no primary key".into());
            return (editable, total_records);
        }
        let colnames: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
        if !pk.iter().all(|c| colnames.contains(c)) {
            editable.reason_disabled = Some("Primary key columns are not present in result".into());
            return (editable, total_records);
        }
        editable.enabled = true;
        editable.primary_key_columns = Some(pk);
    }

    let count_sql = format!(
        "SELECT COUNT(*) AS count FROM {}",
        qualify_table(&DbType::Mysql, Some(&schema), table)
    );
    if let Ok(row) = sqlx::query_scalar::<_, i64>(&count_sql).fetch_one(pool).await {
        if row >= 0 {
            total_records = Some(row as u64);
        }
    }

    (editable, total_records)
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
            let inserted = run_pg_with_retries(&state, &config, |p| {
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
            let inserted = run_mysql_with_retries(&state, &config, |p| {
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
