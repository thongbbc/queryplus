# Tauri SQL Desktop App — TablePlus Clone Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a cross-platform desktop SQL client (like TablePlus) using Tauri v2 + React/TypeScript, supporting MySQL, MariaDB, and PostgreSQL with connection management, SQL script editing, and query execution.

**Architecture:** Tauri v2 (Rust backend for native DB drivers + filesystem) + React + TypeScript frontend. All DB connections run locally via Rust's `sqlx` crate. SQL editor uses CodeMirror 6. UI inspired by TablePlus — sidebar for connections, tabs for queries, split-panel result grid.

**Tech Stack:**
- **Desktop:** Tauri v2 (Rust)
- **Frontend:** React 18 + TypeScript + Vite
- **SQL Editor:** CodeMirror 6
- **UI:** Tailwind CSS + custom components (TablePlus-like)
- **DB Drivers:** `sqlx` (Postgres, MySQL) via Rust backend
- **State Management:** Zustand (lightweight)
- **Build tool:** Vite + Tauri CLI

---

## Phase 0: Prerequisites & Project Scaffold

### Task 0.1: Install Prerequisites

**Objective:** Install Rust, Tauri CLI, and system dependencies on the dev machine.

**Notes:** The server is ARM64 Debian but the dev machine is likely macOS. Below commands are for macOS (homebrew). Adjust if on Windows/Linux.

**Step 1: Install Rust**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

**Step 2: Install Tauri CLI**
```bash
cargo install tauri-cli --version "^2"
```

**Step 3: Install system dependencies**
```bash
# macOS
brew install webkit2gtk

# Ubuntu/Debian
sudo apt update && sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Step 4: Verify**
```bash
rustc --version   # >= 1.70
cargo tauri --version  # >= 2.0
node --version    # >= 18
```

---

### Task 0.2: Scaffold Tauri + React Project

**Objective:** Create the base Tauri v2 project with React + TypeScript + Vite.

**Step 1: Create project with Tauri CLI**
```bash
npm create tauri-app@latest sqlpad -- --template react-ts --manager npm
cd sqlpad
npm install
```

**Step 2: Install core dependencies**
```bash
npm install zustand @tauri-apps/api @tauri-apps/plugin-sql
npm install -D tailwindcss @tailwindcss/vite
npm install codemirror @codemirror/view @codemirror/state @codemirror/lang-sql @codemirror/commands @codemirror/autocomplete @codemirror/language @codemirror/search @codemirror/theme-one-dark uiw/react-codemirror
```

**Step 3: Add Rust dependencies in `src-tauri/Cargo.toml`**
```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-sql = { version = "2", features = ["postgres", "mysql"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
```

**Step 4: Register plugins in `src-tauri/src/lib.rs`**
```rust
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 5: Add `tauri.conf.json` capabilities**
```json
{
  "identifier": "com.sqlpad.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "title": "SQLPad",
    "windows": [
      {
        "title": "SQLPad",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

**Step 6: Verify scaffold builds**
```bash
cd sqlpad
npm run tauri dev
```
Expected: Window opens with default Tauri + React app.

---

## Phase 1: Connection Management (Core)

### Task 1.1: Connection Models & Storage (Rust)

**Objective:** Define connection config structs and implement persistent storage using local SQLite (via tauri-plugin-sql).

**Files:**
- Create: `src-tauri/src/connection.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create connection module**

`src-tauri/src/connection.rs`:
```rust
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DbType {
    Postgres,
    Mysql,
    Mariadb,
}

impl DbType {
    pub fn default_port(&self) -> u16 {
        match self {
            DbType::Postgres => 5432,
            DbType::Mysql | DbType::Mariadb => 3306,
        }
    }
}
```

**Step 2: Register connection module in lib.rs**
```rust
mod connection;
```

**Step 3: Create connection storage helper using tauri-plugin-sql**
The plugin handles persistence internally. We'll store connections in a local SQLite file managed by the plugin.

---

### Task 1.2: Connection CRUD Commands (Rust)

**Objective:** Implement Tauri commands for listing, creating, editing, deleting connections.

**Files:**
- Create: `src-tauri/src/commands/connection_commands.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create commands module**

`src-tauri/src/commands/mod.rs`:
```rust
pub mod connection_commands;
```

`src-tauri/src/commands/connection_commands.rs`:
```rust
use crate::connection::{ConnectionConfig, DbType};
use tauri::State;
use std::sync::Mutex;
use uuid::Uuid;

pub struct ConnectionStore(pub Mutex<Vec<ConnectionConfig>>);

#[tauri::command]
pub fn list_connections(store: State<ConnectionStore>) -> Vec<ConnectionConfig> {
    store.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn create_connection(
    store: State<ConnectionStore>,
    name: String,
    db_type: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    database: String,
    ssl: bool,
) -> ConnectionConfig {
    let now = chrono::Utc::now().to_rfc3339();
    let config = ConnectionConfig {
        id: Uuid::new_v4().to_string(),
        name,
        db_type: match db_type.as_str() {
            "postgres" => DbType::Postgres,
            "mysql" => DbType::Mysql,
            "mariadb" => DbType::Mariadb,
            _ => DbType::Postgres,
        },
        host,
        port,
        username,
        password,
        database,
        ssl,
        created_at: now.clone(),
        updated_at: now,
    };
    store.0.lock().unwrap().push(config.clone());
    config
}
```

**Step 2: Register commands in lib.rs**
```rust
mod commands;
use commands::connection_commands::ConnectionStore;

pub fn run() {
    tauri::Builder::default()
        .manage(ConnectionStore(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            commands::connection_commands::list_connections,
            commands::connection_commands::create_connection,
        ])
        // ... rest
}
```

**Step 3: Add chrono + uuid to Cargo.toml**
```toml
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4", "serde"] }
```

---

### Task 1.3: Test Connection Command (Rust)

**Objective:** Implement test connection that actually connects to the database and returns success/failure.

**Files:**
- Modify: `src-tauri/src/commands/connection_commands.rs`

**Step 1: Add test_connection command**
```rust
#[tauri::command]
pub async fn test_connection(
    db_type: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    database: String,
    ssl: bool,
) -> Result<String, String> {
    use sqlx::Executor;
    
    let conn_string = match db_type.as_str() {
        "postgres" => format!("postgresql://{}:{}@{}:{}/{}", username, password, host, port, database),
        "mysql" | "mariadb" => format!("mysql://{}:{}@{}:{}/{}", username, password, host, port, database),
        _ => return Err("Unsupported database type".into()),
    };

    match sqlx::any::AnyPoolOptions::new()
        .max_connections(1)
        .connect_timeout(std::time::Duration::from_secs(10))
        .connect(&conn_string)
        .await
    {
        Ok(pool) => {
            let result = sqlx::query("SELECT 1 AS result").execute(&pool).await;
            pool.close().await;
            match result {
                Ok(_) => Ok("Connected successfully!".into()),
                Err(e) => Err(format!("Query failed: {}", e)),
            }
        }
        Err(e) => Err(format!("Connection failed: {}", e)),
    }
}
```

**Step 2: Register test_connection in handler**

**Step 3: Persist connections to filesystem**
Use Tauri's `app_data_dir` to save connections as JSON file:

`src-tauri/src/commands/connection_commands.rs`:
```rust
use tauri::Manager;
use std::fs;
use std::path::PathBuf;

fn get_store_path(app: &tauri::AppHandle) -> PathBuf {
    let path = app.path().app_data_dir().unwrap().join("connections.json");
    path
}

#[tauri::command]
pub fn save_connections(app: tauri::AppHandle, connections: Vec<ConnectionConfig>) -> Result<(), String> {
    let path = get_store_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&connections).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_connections(app: tauri::AppHandle) -> Vec<ConnectionConfig> {
    let path = get_store_path(&app);
    if !path.exists() {
        return vec![];
    }
    let json = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    serde_json::from_str(&json).unwrap_or_default()
}
```

---

### Task 1.4: Connection UI — Sidebar & Modal

**Objective:** Build sidebar with connection list + connect/disconnect + modal for adding connections (TablePlus-style).

**Frontend files:**
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/ConnectionModal.tsx`
- Create: `src/components/ConnectionCard.tsx`
- Create: `src/stores/connectionStore.ts`
- Create: `src/types/connection.ts`

**Step 1: Define types**
`src/types/connection.ts`:
```typescript
export type DbType = 'postgres' | 'mysql' | 'mariadb';

export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: DbType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  created_at: string;
  updated_at: string;
}
```

**Step 2: Zustand store**
`src/stores/connectionStore.ts` — manages connections list, active connection, connection status.

**Step 3: Sidebar component**
Left sidebar showing connection list with:
- DB type icon (color-coded: PostgreSQL blue, MySQL orange, MariaDB teal)
- Connection name
- Connect/disconnect button
- "New Connection" button at bottom

**Step 4: ConnectionModal component**
Full-screen or large modal (like TablePlus) with:
- DB type selector (dropdown with icons)
- Name field
- Host + Port (port auto-fills based on DB type)
- Username + Password
- Database name
- SSL toggle
- "Test Connection" button (calls `test_connection` via Tauri invoke)
- "Save" button
- Cancel button

**Step 5: Wire up to backend**
Use `@tauri-apps/api/core` `invoke()` to call Rust commands:
```typescript
import { invoke } from '@tauri-apps/api/core';

const result = await invoke('test_connection', { dbType: 'postgres', host: 'localhost', ... });
```

---

### Task 1.5: Connection Pool Management (Rust)

**Objective:** Manage active DB connections — open on connect, keep alive, auto-reconnect on disconnect.

**Files:**
- Create: `src-tauri/src/db_pool.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Connection pool manager**

`src-tauri/src/db_pool.rs`:
```rust
use sqlx::{Pool, Any};
use std::collections::HashMap;
use std::sync::Mutex;
use crate::connection::{ConnectionConfig, DbType};

pub struct DbPoolManager {
    pools: Mutex<HashMap<String, Pool<Any>>>,
}

impl DbPoolManager {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }

    pub async fn connect(&self, config: &ConnectionConfig) -> Result<(), String> {
        let conn_string = match config.db_type {
            DbType::Postgres => format!("postgresql://{}:{}@{}:{}/{}", config.username, config.password, config.host, config.port, config.database),
            DbType::Mysql | DbType::Mariadb => format!("mysql://{}:{}@{}:{}/{}", config.username, config.password, config.host, config.port, config.database),
        };

        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(5)
            .connect(&conn_string)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        self.pools.lock().unwrap().insert(config.id.clone(), pool);
        Ok(())
    }

    pub fn disconnect(&self, id: &str) {
        self.pools.lock().unwrap().remove(id);
    }

    pub fn get_pool(&self, id: &str) -> Option<Pool<Any>> {
        self.pools.lock().unwrap().get(id).cloned()
    }

    pub fn is_connected(&self, id: &str) -> bool {
        self.pools.lock().unwrap().contains_key(id)
    }
}
```

**Step 2: Manage in lib.rs**
```rust
use db_pool::DbPoolManager;
// ...
.manage(DbPoolManager::new())
```

**Step 3: Add commands for connect/disconnect**
```rust
#[tauri::command]
pub async fn db_connect(
    config: ConnectionConfig,
    pool_manager: State<'_, DbPoolManager>,
) -> Result<String, String> {
    pool_manager.connect(&config).await?;
    Ok(format!("Connected to {}", config.name))
}

#[tauri::command]
pub fn db_disconnect(
    id: String,
    pool_manager: State<'_, DbPoolManager>,
) -> Result<(), String> {
    pool_manager.disconnect(&id);
    Ok(())
}
```

---

### Task 1.6: Auto-Reconnect Logic

**Objective:** If a query fails due to connection loss, attempt to reconnect transparently.

**Files:**
- Modify: `src-tauri/src/db_pool.rs`
- Modify: `src-tauri/src/commands/query_commands.rs`

**Logic:**
```rust
pub async fn execute_with_reconnect(
    pool_manager: &DbPoolManager,
    config: &ConnectionConfig,
    query: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let pool = pool_manager.get_pool(&config.id);
    let pool = match pool {
        Some(p) => p,
        None => {
            // Auto-reconnect
            pool_manager.connect(config).await?;
            pool_manager.get_pool(&config.id).ok_or("Failed to reconnect")?
        }
    };

    // Try query, reconnect on failure
    let result = sqlx::query(query).fetch_all(&pool).await;
    match result {
        Ok(rows) => Ok(rows.into_iter().map(|r| {
            // Convert row to JSON
            serde_json::to_value(r).unwrap_or(serde_json::Value::Null)
        }).collect()),
        Err(e) => {
            if is_connection_error(&e) {
                pool_manager.connect(config).await?;
                let pool = pool_manager.get_pool(&config.id).ok_or("Reconnect failed")?;
                let rows = sqlx::query(query).fetch_all(&pool).await.map_err(|e| format!("Query failed after reconnect: {}", e))?;
                Ok(rows.into_iter().map(|r| {
                    serde_json::to_value(r).unwrap_or(serde_json::Value::Null)
                }).collect())
            } else {
                Err(format!("Query error: {}", e))
            }
        }
    }
}

fn is_connection_error(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Database(db_err) => {
            let msg = db_err.message().to_lowercase();
            msg.contains("connection") || msg.contains("closed") || msg.contains("terminate")
        }
        sqlx::Error::Io(_) => true,
        _ => false,
    }
}
```

---

## Phase 2: SQL Editor & Query Execution

### Task 2.1: SQL Editor Component (CodeMirror 6)

**Objective:** Build the main SQL editor panel with syntax highlighting, multi-query support, and keyboard shortcuts.

**Files:**
- Create: `src/components/SqlEditor.tsx`
- Create: `src/components/EditorTab.tsx`
- Create: `src/stores/editorStore.ts`

**Step 1: Create editor store**
```typescript
interface EditorTab {
  id: string;
  name: string;
  content: string;
  connectionId: string;
  database: string;
  filePath?: string;
  isSaved: boolean;
}
```

**Step 2: SqlEditor component using CodeMirror**
```typescript
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
```

Features:
- SQL syntax highlighting
- Line numbers
- Multiple cursor support
- Bracket matching
- Auto-complete for SQL keywords

**Step 3: Keyboard shortcuts**
- `Ctrl + Enter`: Run selected text (or current statement if nothing selected)
- `Ctrl + S`: Save script to file
- `Ctrl + Shift + E`: Run all queries

**Step 4: Statement selection logic**
When no text is selected, use CodeMirror's syntax tree to find the SQL statement at cursor position.

---

### Task 2.2: Result Grid Component

**Objective:** Build a data grid to display query results (like TablePlus).

**Files:**
- Create: `src/components/ResultGrid.tsx`
- Create: `src/components/ResultTabs.tsx` (for running multiple queries)

**Features:**
- Virtual scrolling for large result sets
- Column header with type indicators
- Row numbers
- Cell selection and copy
- Column resize
- Sort indicator

**Implementation approach:**
Use `@tanstack/react-virtual` for virtualized rows. Plain HTML table with CSS Grid — no heavy grid library needed.

---

### Task 2.3: Query Execution Flow (Rust + Frontend)

**Objective:** Wire editor → execute query → display results.

**Files:**
- Create: `src-tauri/src/commands/query_commands.rs`

**Step 1: Execute query command**
```rust
#[tauri::command]
pub async fn execute_query(
    connection_id: String,
    query: String,
    pool_manager: State<'_, DbPoolManager>,
) -> Result<QueryResult, String> {
    let config = get_connection_config(connection_id); // from store
    let result = execute_with_reconnect(&pool_manager, &config, &query).await?;
    Ok(result)
}

#[derive(Serialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub execution_time_ms: u64,
}

#[derive(Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
}
```

**Step 2: Frontend query runner**
```typescript
async function runQuery(connectionId: string, sql: string) {
  const start = performance.now();
  const result = await invoke<QueryResult>('execute_query', { connectionId, query: sql });
  const elapsed = performance.now() - start;
  setResult({ ...result, executionTimeMs: elapsed });
}
```

---

### Task 2.4: Database & Schema Browser

**Objective:** Show list of databases and tables in the sidebar (like TablePlus left panel).

**Files:**
- Create: `src/components/SchemaBrowser.tsx`
- Create: `src-tauri/src/commands/schema_commands.rs`

**Step 1: Schema commands**
```rust
#[tauri::command]
pub async fn list_databases(connection_id: String) -> Result<Vec<String>, String> {
    // SELECT datname FROM pg_database for Postgres
    // SHOW DATABASES for MySQL
}

#[tauri::command]
pub async fn list_tables(connection_id: String, database: String) -> Result<Vec<String>, String> {
    // SELECT table_name FROM information_schema.tables for both
}

#[tauri::command]
pub async fn list_columns(connection_id: String, database: String, table: String) -> Result<Vec<ColumnInfo>, String> {
    // SELECT column_name, data_type FROM information_schema.columns
}
```

**Step 2: SchemaBrowser component**
Tree view in sidebar:
```
▸ database_name
  ▸ schemas (postgres)
    ▸ public
      ▸ users
        ├── id (int4) PK
        ├── name (varchar)
        └── email (varchar)
      ▸ orders
        └── ...
  ▸ Tables (mysql)
    └── ...
```

Clicking a table → auto-inserts `SELECT * FROM table_name LIMIT 100` into editor.

---

### Task 2.5: DB Selector Dropdown

**Objective:** Allow user to switch database within a connection before running queries.

**Frontend:**
- Add a dropdown at top of editor area showing current database
- Fetch database list on connect
- Execute `USE database_name` (MySQL) or set search_path (Postgres) when switching

---

## Phase 3: Script File Management

### Task 3.1: Save/Load SQL Scripts

**Objective:** Save SQL editor content as `.sql` files, organized per connection.

**Files:**
- Create: `src-tauri/src/commands/script_commands.rs`

**Step 1: Script commands**
```rust
#[tauri::command]
pub async fn save_script(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_script(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_scripts(dir: String) -> Result<Vec<ScriptInfo>, String> {
    // List .sql files in connection-specific directory
}
```

**Step 2: Script storage organization**
```
~/.sqlpad/scripts/
  ├── <connection_id>/
  │   ├── my_query.sql
  │   └── analytics.sql
  └── ...
```

**Step 3: Frontend file browser**
Add script list panel in sidebar (below connection list):
- "New Script" button → opens new tab
- Script list per connection
- Right-click context menu: Rename, Delete, Reveal in Finder

---

### Task 3.2: File Dialog for Save As

**Objective:** Allow user to choose save location via native file dialog.

**Step 1: Use Tauri dialog plugin**
```bash
npm install @tauri-apps/plugin-dialog
```

**Step 2: Add dialog to Cargo.toml**
```toml
tauri-plugin-dialog = "2"
```

**Step 3: Register plugin in lib.rs**
```rust
.plugin(tauri_plugin_dialog::init())
```

**Step 4: Frontend save flow**
```typescript
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';

async function saveScriptAs(content: string) {
  const filePath = await save({
    filters: [{ name: 'SQL', extensions: ['sql'] }],
    defaultPath: '~/Documents/query.sql'
  });
  if (filePath) {
    await writeTextFile(filePath, content);
    return filePath;
  }
}
```

---

## Phase 4: UI Polish — TablePlus Look & Feel

### Task 4.1: App Shell Layout

**Objective:** Build the three-panel layout matching TablePlus.

**Layout:**
```
┌──────────┬──────────────────────────────────────────────┐
│          │  ┌─────────────────────────────────────────┐ │
│ Sidebar  │  │  Toolbar (DB selector, Run, Save, etc)   │ │
│ (240px)  │  ├─────────────────────────────────────────┤ │
│          │  │  Editor Tabs                              │ │
│ ┌──────┐ │  │  ┌──────┬──────┬──────┬────┬──────┐    │ │
│ │Conn 1│ │  │  │Query1│Query2│  +   │ ...│      │    │ │
│ │Conn 2│ │  │  ├─────────────────────────────────┤    │ │
│ │Conn 3│ │  │  │  SQL Editor (CodeMirror)          │    │ │
│ │      │ │  │  │                                   │    │ │
│ ├──────┤ │  │  │                                   │    │ │
│ │Script│ │  │  ├─────────────────────────────────┤    │ │
│ │Files │ │  │  │  Results Grid                     │    │ │
│ └──────┘ │  │  │  ┌────┬──────┬──────┬──────┐     │    │ │
│          │  │  │  │ id │ name │ email│ age   │     │    │ │
│          │  │  │  ├────┼──────┼──────┼──────┤     │    │ │
│          │  │  │  │ 1  │ Alice│ a@b  │ 30   │     │    │ │
│          │  │  │  └────┴──────┴──────┴──────┘     │    │ │
│          │  │  │  3 rows | 0.01s                   │    │ │
│          │  └─────────────────────────────────────────┘ │
└──────────┴──────────────────────────────────────────────┘
```

**Files:**
- Create: `src/App.tsx` (main layout)
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/Toolbar.tsx`
- Create: `src/components/StatusBar.tsx`

### Task 4.2: Styling — Dark Theme

**Objective:** TablePlus dark theme colors and typography.

Use Tailwind CSS with custom theme:
```css
/* TablePlus-inspired colors */
:root {
  --sidebar-bg: #1e1e24;
  --sidebar-hover: #2a2a32;
  --editor-bg: #1a1a22;
  --result-bg: #121219;
  --border-color: #2a2a32;
  --text-primary: #e0e0e0;
  --text-secondary: #888;
  --accent-blue: #3b82f6;
  --postgres-color: #336791;
  --mysql-color: #f29111;
  --mariadb-color: #c0765c;
}
```

### Task 4.3: Connection Status Indicators

**Objective:** Show connected/disconnected status with green/red dot.

- Green dot + "Connected" text when pool is active
- Red dot + "Disconnected" when not
- Click to reconnect
- Status bar at bottom showing connection info

### Task 4.4: Results Grid Polish

**Objective:** Match TablePlus data grid UX.

**Features:**
- Alternating row colors
- Column sorting (click header)
- Cell value tooltip on truncation
- Null cells shown as `NULL` in gray italics
- Copy cell value on click
- Export results as CSV (button in toolbar)
- Row count + execution time in status bar

---

## Phase 5: Cross-Platform Build & Distribution

### Task 5.1: Platform-Specific Builds

**Objective:** Configure Tauri to build for macOS, Windows, Linux.

**macOS:**
```bash
npm run tauri build -- --target universal-apple-darwin
# Produces .app + .dmg
```

**Windows (cross-compile from macOS):**
- Install `cross` or use GitHub Actions
```bash
cargo tauri build --target x86_64-pc-windows-msvc
# Produces .msi
```

**Linux:**
```bash
cargo tauri build --target x86_64-unknown-linux-gnu
# Produces .deb + .AppImage
```

### Task 5.2: Auto-Updater (Future)

**Optional:** Use Tauri updater plugin for automatic updates.

---

## Summary of Files to Create

```
sqlpad/
├── src/
│   ├── App.tsx                          # Main layout
│   ├── main.tsx                         # Entry point
│   ├── types/
│   │   └── connection.ts                # TypeScript types
│   ├── stores/
│   │   ├── connectionStore.ts           # Connection state
│   │   ├── editorStore.ts               # Editor tabs state
│   │   └── queryStore.ts               # Query results state
│   ├── components/
│   │   ├── Sidebar.tsx                  # Left panel
│   │   ├── ConnectionModal.tsx          # Add/edit connection
│   │   ├── ConnectionCard.tsx           # Connection item
│   │   ├── SchemaBrowser.tsx            # DB tree view
│   │   ├── SqlEditor.tsx               # CodeMirror editor
│   │   ├── EditorTab.tsx                # Tab bar
│   │   ├── ResultGrid.tsx              # Results table
│   │   ├── ResultTabs.tsx              # Multiple results
│   │   ├── Toolbar.tsx                  # Top toolbar
│   │   ├── StatusBar.tsx               # Bottom status bar
│   │   └── ScriptList.tsx              # File browser
│   └── lib/
│       └── invoke.ts                    # Tauri invoke helpers
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                      # Entry
│   │   ├── lib.rs                       # App builder
│   │   ├── connection.rs                # Connection models
│   │   ├── db_pool.rs                   # Connection pool manager
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── connection_commands.rs   # CRUD + test
│   │       ├── query_commands.rs        # Execute queries
│   │       ├── schema_commands.rs       # DB metadata
│   │       └── script_commands.rs       # File management
│   └── Cargo.toml
└── package.json
```

---

## Risks, Tradeoffs & Open Questions

| Risk | Mitigation |
|------|------------|
| `sqlx` Any driver differences between Postgres/MySQL | Abstract per-DB-type logic in schema commands |
| Large result sets (>100K rows) freeze UI | Paginate results, use streaming cursor |
| Password security in local JSON | Tauri provides secure storage via OS keychain (can add later) |
| Connection pool memory leak | Auto-close idle connections after 5 min |
| Auto-reconnect loops endlessly | Max 3 retries with exponential backoff |
| ARM64 dev machine (M1/M2) | Tauri supports ARM64 natively |

**Open Questions:**
1. SSH tunneling support? (TablePlus has it — can add as `libssh2` in Rust later)
2. Session management between app restarts? (Save open tabs and restore)
3. Keyboard shortcut customization?
4. Query history panel?

---

## Verification Checklist

- [ ] `npm run tauri dev` opens the app
- [ ] Add connection form validates all fields
- [ ] Test connection button works for Postgres + MySQL + MariaDB
- [ ] Connection persists after app restart
- [ ] SQL editor has syntax highlighting
- [ ] `Ctrl+Enter` runs selected query, `Ctrl+Shift+E` runs all
- [ ] `Ctrl+S` opens save dialog for .sql file
- [ ] Results display with correct columns and rows
- [ ] Auto-reconnect on connection drop
- [ ] Schema browser shows databases and tables
- [ ] DB selector switches database within connection
- [ ] Builds on macOS, Windows, Linux

---

*Plan saved: .hermes/plans/2026-05-02_074700-tauri-sql-tableplus-app.md*
