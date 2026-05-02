import { create } from "zustand";
import { invokeJson } from "../lib/invoke";
import type { ConnectionConfig, DbType } from "../types/connection";
import { useEditorStore } from "./editorStore";

type ConnectionStatus = "connected" | "disconnected" | "connecting";

type ConnectionState = {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  statusById: Record<string, ConnectionStatus>;
  errorById: Record<string, string | undefined>;

  load: () => Promise<void>;
  save: () => Promise<void>;
  upsert: (conn: ConnectionConfig) => void;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;

  testConnection: (input: {
    dbType: DbType;
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    ssl: boolean;
  }) => Promise<string>;

  listDatabases: (connectionId: string) => Promise<string[]>;
  setDatabase: (connectionId: string, database: string) => Promise<void>;

  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
};

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  statusById: {},
  errorById: {},

  load: async () => {
    const connections = await invokeJson<ConnectionConfig[]>("load_connections");
    const nextActiveId = connections[0]?.id ?? null;
    set({
      connections,
      activeConnectionId: nextActiveId,
      statusById: Object.fromEntries(connections.map((c) => [c.id, "disconnected"])) as Record<string, ConnectionStatus>,
      errorById: {},
    });
    useEditorStore.getState().setActiveConnection(nextActiveId);
  },

  save: async () => {
    const { connections } = get();
    await invokeJson<void>("save_connections", { connections });
  },

  upsert: (conn) => {
    set((s) => {
      const idx = s.connections.findIndex((c) => c.id === conn.id);
      const next = [...s.connections];
      if (idx >= 0) next[idx] = conn;
      else next.unshift(conn);
      return {
        connections: next,
        statusById: { ...s.statusById, [conn.id]: s.statusById[conn.id] ?? "disconnected" },
      };
    });
  },

  remove: (id) => {
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      statusById: Object.fromEntries(Object.entries(s.statusById).filter(([k]) => k !== id)) as Record<string, ConnectionStatus>,
      errorById: Object.fromEntries(Object.entries(s.errorById).filter(([k]) => k !== id)) as Record<string, string | undefined>,
      activeConnectionId: s.activeConnectionId === id ? null : s.activeConnectionId,
    }));
    const nextActive = get().activeConnectionId;
    useEditorStore.getState().setActiveConnection(nextActive);
  },

  setActive: (id) => {
    set({ activeConnectionId: id });
    useEditorStore.getState().setActiveConnection(id);
  },

  testConnection: async (input) => {
    return await invokeJson<string>("test_connection", {
      dbType: input.dbType,
      host: input.host,
      port: input.port,
      username: input.username,
      password: input.password,
      database: input.database,
      ssl: input.ssl,
    });
  },

  listDatabases: async (connectionId) => {
    return await invokeJson<string[]>("list_databases", { connectionId });
  },

  setDatabase: async (connectionId, database) => {
    const { connections } = get();
    const idx = connections.findIndex((c) => c.id === connectionId);
    if (idx < 0) return;
    const next = [...connections];
    next[idx] = { ...next[idx], database, updated_at: new Date().toISOString() };
    set({ connections: next });
    await invokeJson<void>("save_connections", { connections: next });
  },

  connect: async (id) => {
    set((s) => ({ statusById: { ...s.statusById, [id]: "connecting" }, errorById: { ...s.errorById, [id]: undefined } }));
    try {
      await invokeJson<string>("db_connect", { connectionId: id });
      set((s) => ({ statusById: { ...s.statusById, [id]: "connected" } }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set((s) => ({
        statusById: { ...s.statusById, [id]: "disconnected" },
        errorById: { ...s.errorById, [id]: message },
      }));
      throw e;
    }
  },

  disconnect: async (id) => {
    await invokeJson<void>("db_disconnect", { connectionId: id });
    set((s) => ({ statusById: { ...s.statusById, [id]: "disconnected" } }));
  },
}));
