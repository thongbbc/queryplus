export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type ColumnInfo = {
  name: string;
  data_type: string;
  enum_values?: string[];
};

export type EditableResultInfo = {
  enabled: boolean;
  reason_disabled?: string;
  database: string;
  schema?: string;
  table?: string;
  primary_key_columns?: string[];
};

export type QueryPagination = {
  limit?: number;
  offset?: number;
  page?: number;
  page_size?: number;
};

export type QueryResult = {
  columns: ColumnInfo[];
  rows: JsonValue[][];
  row_count: number;
  execution_time_ms: number;
  editable?: EditableResultInfo;
  pagination?: QueryPagination;
  total_records?: number;
  affected_rows?: number;
};

export type RowKey = JsonValue[];

export type RowUpdate = {
  key: RowKey;
  set: Record<string, JsonValue>;
};

export type RowDelete = {
  key: RowKey;
};

export type RowInsert = {
  values: Record<string, JsonValue>;
};

export type ApplyChangesInput = {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
  primaryKeyColumns: string[];
  inserts: RowInsert[];
  updates: RowUpdate[];
  deletes: RowDelete[];
};

export type ApplyChangesResult = {
  inserted_count: number;
  updated_count: number;
  deleted_count: number;
};
