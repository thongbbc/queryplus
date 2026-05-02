export type DbType = "postgres" | "mysql" | "mariadb";

export type ConnectionConfig = {
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
};

export function defaultPort(dbType: DbType): number {
  if (dbType === "postgres") return 5432;
  return 3306;
}

