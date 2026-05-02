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
  runningById: Record<string, boolean>;
  errorById: Record<string, string | null>;
  lastQueryById: Record<string, string>;
  resultById: Record<string, QueryResult | null>;
  runSeqById: Record<string, number>;
  dirtyById: Record<string, DirtyState>;

  clearDirty: (connectionId: string) => void;
  toggleSelect: (connectionId: string, key: RowKey) => void;
  selectAll: (connectionId: string, keys: RowKey[]) => void;
  clearSelection: (connectionId: string) => void;
  markDeleted: (connectionId: string, key: RowKey) => void;
  undoDelete: (connectionId: string, key: RowKey) => void;
  setCell: (connectionId: string, key: RowKey, column: string, value: JsonValue) => void;
  addInsertRow: (connectionId: string) => void;
  setInsertCell: (connectionId: string, insertId: string, column: string, value: JsonValue) => void;
  removeInsertRow: (connectionId: string, insertId: string) => void;

  runQuery: (input: { connectionId: string; query: string }) => Promise<void>;
  applySave: (input: { connectionId: string }) => Promise<ApplyChangesResult>;
};

function keyToString(key: RowKey): string {
  return JSON.stringify(key);
}

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function emptyDirty(): DirtyState {
  return { inserts: [], updatesByKey: {}, deletesByKey: {}, selectedKeys: {} };
}

export const useQueryStore = create<QueryState>((set, get) => ({
  runningById: {},
  errorById: {},
  lastQueryById: {},
  resultById: {},
  runSeqById: {},
  dirtyById: {},

  clearDirty: (connectionId) => set((s) => ({ dirtyById: { ...s.dirtyById, [connectionId]: emptyDirty() } })),

  toggleSelect: (connectionId, key) => {
    const ks = keyToString(key);
    set((s) => {
      const dirty = s.dirtyById[connectionId] ?? emptyDirty();
      const next = { ...dirty.selectedKeys };
      if (next[ks]) delete next[ks];
      else next[ks] = true;
      return { dirtyById: { ...s.dirtyById, [connectionId]: { ...dirty, selectedKeys: next } } };
    });
  },

  selectAll: (connectionId, keys) => {
    set((s) => ({
      dirtyById: {
        ...s.dirtyById,
        [connectionId]: {
          ...(s.dirtyById[connectionId] ?? emptyDirty()),
          selectedKeys: Object.fromEntries(keys.map((k) => [keyToString(k), true])) as Record<string, true>,
        },
      },
    }));
  },

  clearSelection: (connectionId) =>
    set((s) => ({ dirtyById: { ...s.dirtyById, [connectionId]: { ...(s.dirtyById[connectionId] ?? emptyDirty()), selectedKeys: {} } } })),

  markDeleted: (connectionId, key) => {
    const ks = keyToString(key);
    set((s) => {
      const dirty = s.dirtyById[connectionId] ?? emptyDirty();
      return { dirtyById: { ...s.dirtyById, [connectionId]: { ...dirty, deletesByKey: { ...dirty.deletesByKey, [ks]: true } } } };
    });
  },

  undoDelete: (connectionId, key) => {
    const ks = keyToString(key);
    set((s) => {
      const dirty = s.dirtyById[connectionId] ?? emptyDirty();
      const next = { ...dirty.deletesByKey };
      delete next[ks];
      return { dirtyById: { ...s.dirtyById, [connectionId]: { ...dirty, deletesByKey: next } } };
    });
  },

  setCell: (connectionId, key, column, value) => {
    const ks = keyToString(key);
    set((s) => {
      const dirty = s.dirtyById[connectionId] ?? emptyDirty();
      const existing = dirty.updatesByKey[ks] ?? {};
      return {
        dirtyById: {
          ...s.dirtyById,
          [connectionId]: {
            ...dirty,
            updatesByKey: {
              ...dirty.updatesByKey,
              [ks]: { ...existing, [column]: value },
            },
          },
        },
      };
    });
  },

  addInsertRow: (connectionId) => {
    const id = `ins-${uid()}`;
    set((s) => {
      const dirty = s.dirtyById[connectionId] ?? emptyDirty();
      return { dirtyById: { ...s.dirtyById, [connectionId]: { ...dirty, inserts: [{ id, values: {} }, ...dirty.inserts] } } };
    });
  },

  setInsertCell: (connectionId, insertId, column, value) => {
    set((s) => ({
      dirtyById: {
        ...s.dirtyById,
        [connectionId]: {
          ...(s.dirtyById[connectionId] ?? emptyDirty()),
          inserts: (s.dirtyById[connectionId] ?? emptyDirty()).inserts.map((r) =>
            r.id === insertId ? { ...r, values: { ...r.values, [column]: value } } : r
          ),
        },
      },
    }));
  },

  removeInsertRow: (connectionId, insertId) => {
    set((s) => ({
      dirtyById: {
        ...s.dirtyById,
        [connectionId]: {
          ...(s.dirtyById[connectionId] ?? emptyDirty()),
          inserts: (s.dirtyById[connectionId] ?? emptyDirty()).inserts.filter((r) => r.id !== insertId),
        },
      },
    }));
  },

  runQuery: async ({ connectionId, query }) => {
    const normalized = ensureLimitOffset(query, { limit: 100, offset: 0 });
    const seq = (get().runSeqById[connectionId] ?? 0) + 1;
    set((s) => ({
      runningById: { ...s.runningById, [connectionId]: true },
      errorById: { ...s.errorById, [connectionId]: null },
      lastQueryById: { ...s.lastQueryById, [connectionId]: normalized },
      resultById: { ...s.resultById, [connectionId]: null },
      runSeqById: { ...s.runSeqById, [connectionId]: seq },
    }));
    try {
      const result = await invokeJson<QueryResult>("execute_query", { connectionId, query: normalized });
      if ((get().runSeqById[connectionId] ?? 0) !== seq) return;
      set((s) => ({ resultById: { ...s.resultById, [connectionId]: result }, runningById: { ...s.runningById, [connectionId]: false } }));
      get().clearDirty(connectionId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if ((get().runSeqById[connectionId] ?? 0) !== seq) return;
      set((s) => ({ runningById: { ...s.runningById, [connectionId]: false }, errorById: { ...s.errorById, [connectionId]: message } }));
      throw e;
    }
  },

  applySave: async ({ connectionId }) => {
    const result = get().resultById[connectionId] ?? null;
    const dirty = get().dirtyById[connectionId] ?? emptyDirty();
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
    get().clearDirty(connectionId);
    return out;
  },
}));
