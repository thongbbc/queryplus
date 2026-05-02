import { create } from "zustand";
import { invokeJson } from "../lib/invoke";
import type {
  ApplyChangesInput,
  ApplyChangesResult,
  JsonValue,
  QueryResult,
  RowDelete,
  RowInsert,
  RowKey,
  RowUpdate,
} from "../types/query";
import { ensureLimitOffset } from "../utils/sql";

type DirtyState = {
  inserts: { id: string; values: Record<string, JsonValue> }[];
  updatesByKey: Record<string, Record<string, JsonValue>>;
  deletesByKey: Record<string, true>;
  selectedKeys: Record<string, true>;
};

type QueryState = {
  running: boolean;
  error: string | null;
  lastQuery: string;
  result: QueryResult | null;
  dirty: DirtyState;

  clearDirty: () => void;
  toggleSelect: (key: RowKey) => void;
  selectAll: (keys: RowKey[]) => void;
  clearSelection: () => void;
  markDeleted: (key: RowKey) => void;
  undoDelete: (key: RowKey) => void;
  setCell: (key: RowKey, column: string, value: JsonValue) => void;
  addInsertRow: () => void;
  setInsertCell: (insertId: string, column: string, value: JsonValue) => void;
  removeInsertRow: (insertId: string) => void;

  runQuery: (input: { connectionId: string; query: string }) => Promise<void>;
  applySave: (input: { connectionId: string }) => Promise<ApplyChangesResult>;
};

function keyToString(key: RowKey): string {
  return JSON.stringify(key);
}

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export const useQueryStore = create<QueryState>((set, get) => ({
  running: false,
  error: null,
  lastQuery: "",
  result: null,
  dirty: { inserts: [], updatesByKey: {}, deletesByKey: {}, selectedKeys: {} },

  clearDirty: () => set({ dirty: { inserts: [], updatesByKey: {}, deletesByKey: {}, selectedKeys: {} } }),

  toggleSelect: (key) => {
    const ks = keyToString(key);
    set((s) => {
      const next = { ...s.dirty.selectedKeys };
      if (next[ks]) delete next[ks];
      else next[ks] = true;
      return { dirty: { ...s.dirty, selectedKeys: next } };
    });
  },

  selectAll: (keys) => {
    set((s) => ({
      dirty: { ...s.dirty, selectedKeys: Object.fromEntries(keys.map((k) => [keyToString(k), true])) as Record<string, true> },
    }));
  },

  clearSelection: () => set((s) => ({ dirty: { ...s.dirty, selectedKeys: {} } })),

  markDeleted: (key) => {
    const ks = keyToString(key);
    set((s) => ({ dirty: { ...s.dirty, deletesByKey: { ...s.dirty.deletesByKey, [ks]: true } } }));
  },

  undoDelete: (key) => {
    const ks = keyToString(key);
    set((s) => {
      const next = { ...s.dirty.deletesByKey };
      delete next[ks];
      return { dirty: { ...s.dirty, deletesByKey: next } };
    });
  },

  setCell: (key, column, value) => {
    const ks = keyToString(key);
    set((s) => {
      const existing = s.dirty.updatesByKey[ks] ?? {};
      return {
        dirty: {
          ...s.dirty,
          updatesByKey: {
            ...s.dirty.updatesByKey,
            [ks]: { ...existing, [column]: value },
          },
        },
      };
    });
  },

  addInsertRow: () => {
    const id = `ins-${uid()}`;
    set((s) => ({ dirty: { ...s.dirty, inserts: [{ id, values: {} }, ...s.dirty.inserts] } }));
  },

  setInsertCell: (insertId, column, value) => {
    set((s) => ({
      dirty: {
        ...s.dirty,
        inserts: s.dirty.inserts.map((r) => (r.id === insertId ? { ...r, values: { ...r.values, [column]: value } } : r)),
      },
    }));
  },

  removeInsertRow: (insertId) => {
    set((s) => ({ dirty: { ...s.dirty, inserts: s.dirty.inserts.filter((r) => r.id !== insertId) } }));
  },

  runQuery: async ({ connectionId, query }) => {
    const normalized = ensureLimitOffset(query, { limit: 100, offset: 0 });
    set({ running: true, error: null, lastQuery: normalized });
    try {
      const result = await invokeJson<QueryResult>("execute_query", { connectionId, query: normalized });
      set({ result, running: false });
      get().clearDirty();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ running: false, error: message });
      throw e;
    }
  },

  applySave: async ({ connectionId }) => {
    const { result, dirty } = get();
    if (!result?.editable?.enabled || !result.editable.table || !result.editable.primary_key_columns) {
      throw new Error(result?.editable?.reason_disabled ?? "Result is not editable");
    }

    const inserts: RowInsert[] = dirty.inserts.map((r) => ({ values: r.values }));

    const updates: RowUpdate[] = Object.entries(dirty.updatesByKey).map(([ks, setMap]) => ({
      key: JSON.parse(ks) as RowKey,
      set: setMap,
    }));

    const deletes: RowDelete[] = Object.keys(dirty.deletesByKey).map((ks) => ({
      key: JSON.parse(ks) as RowKey,
    }));

    const input: ApplyChangesInput = {
      connectionId,
      database: result.editable.database,
      schema: result.editable.schema,
      table: result.editable.table,
      primaryKeyColumns: result.editable.primary_key_columns,
      inserts,
      updates,
      deletes,
    };

    const out = await invokeJson<ApplyChangesResult>("apply_changes", { input });
    get().clearDirty();
    return out;
  },
}));
