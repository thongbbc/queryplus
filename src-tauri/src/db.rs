use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use sqlx::{MySqlPool, PgPool};

use crate::models::{ConnectionConfig, DbType};

#[derive(Clone)]
pub enum DbPool {
    Postgres(PgPool),
    Mysql(MySqlPool),
}

pub struct DbPoolManager {
    pools: Mutex<HashMap<String, DbPool>>,
}

impl DbPoolManager {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, connection_id: &str) -> Option<DbPool> {
        self.pools.lock().ok().and_then(|m| m.get(connection_id).cloned())
    }

    pub fn remove(&self, connection_id: &str) {
        if let Ok(mut m) = self.pools.lock() {
            m.remove(connection_id);
        }
    }

    pub async fn connect(&self, config: &ConnectionConfig) -> Result<(), String> {
        let pool = connect_pool(config).await?;
        let mut m = self.pools.lock().map_err(|_| "poisoned".to_string())?;
        m.insert(config.id.clone(), pool);
        Ok(())
    }

    pub async fn reconnect(&self, config: &ConnectionConfig) -> Result<(), String> {
        self.remove(&config.id);
        self.connect(config).await
    }
}

fn build_pg_url(config: &ConnectionConfig) -> Result<String, String> {
    let database = if config.database.trim().is_empty() {
        "postgres"
    } else {
        config.database.as_str()
    };
    let mut url = url::Url::parse(&format!(
        "postgresql://{}:{}/{}",
        config.host, config.port, database
    ))
    .map_err(|e| e.to_string())?;
    url.set_username(&config.username).map_err(|_| "invalid username".to_string())?;
    url.set_password(Some(&config.password)).map_err(|_| "invalid password".to_string())?;
    Ok(url.to_string())
}

fn build_mysql_url(config: &ConnectionConfig) -> Result<String, String> {
    let database = if config.database.trim().is_empty() {
        "information_schema"
    } else {
        config.database.as_str()
    };
    let mut url = url::Url::parse(&format!(
        "mysql://{}:{}/{}",
        config.host, config.port, database
    ))
    .map_err(|e| e.to_string())?;
    url.set_username(&config.username).map_err(|_| "invalid username".to_string())?;
    url.set_password(Some(&config.password)).map_err(|_| "invalid password".to_string())?;
    Ok(url.to_string())
}

pub async fn connect_pool(config: &ConnectionConfig) -> Result<DbPool, String> {
    let timeout = Duration::from_secs(10);
    match config.db_type {
        DbType::Postgres => {
            let url = build_pg_url(config)?;
            let pool = sqlx::postgres::PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(timeout)
                .idle_timeout(Duration::from_secs(300))
                .max_lifetime(Duration::from_secs(1800))
                .test_on_acquire(true)
                .connect(&url)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DbPool::Postgres(pool))
        }
        DbType::Mysql | DbType::Mariadb => {
            let url = build_mysql_url(config)?;
            let pool = sqlx::mysql::MySqlPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(timeout)
                .idle_timeout(Duration::from_secs(300))
                .max_lifetime(Duration::from_secs(1800))
                .test_on_acquire(true)
                .connect(&url)
                .await
                .map_err(|e| e.to_string())?;
            Ok(DbPool::Mysql(pool))
        }
    }
}

pub fn is_connection_error(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Io(_) => true,
        sqlx::Error::PoolClosed => true,
        sqlx::Error::PoolTimedOut => true,
        sqlx::Error::Database(db) => {
            let m = db.message().to_lowercase();
            m.contains("connection") || m.contains("closed") || m.contains("terminate") || m.contains("broken")
        }
        _ => false,
    }
}
