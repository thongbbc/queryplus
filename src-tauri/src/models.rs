use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DbType {
    Postgres,
    Mysql,
    Mariadb,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub db_type: DbType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    pub ssl: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditableResultInfo {
    pub enabled: bool,
    pub reason_disabled: Option<String>,
    pub database: String,
    pub schema: Option<String>,
    pub table: Option<String>,
    pub primary_key_columns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryPagination {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    pub page: Option<u64>,
    pub page_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub execution_time_ms: u64,
    pub editable: Option<EditableResultInfo>,
    pub pagination: Option<QueryPagination>,
    pub total_records: Option<u64>,
    pub affected_rows: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RowInsert {
    pub values: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RowUpdate {
    pub key: Vec<serde_json::Value>,
    pub set: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RowDelete {
    pub key: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApplyChangesInput {
    pub connection_id: String,
    pub database: String,
    pub schema: Option<String>,
    pub table: String,
    pub primary_key_columns: Vec<String>,
    pub inserts: Vec<RowInsert>,
    pub updates: Vec<RowUpdate>,
    pub deletes: Vec<RowDelete>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyChangesResult {
    pub inserted_count: u64,
    pub updated_count: u64,
    pub deleted_count: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptInfo {
    pub name: String,
    pub updated_at: Option<String>,
}

