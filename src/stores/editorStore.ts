import { create } from "zustand";

export type EditorTab = {
  id: string;
  name: string;
  content: string;
  connectionId: string | null;
  database: string;
  fileName?: string;
  isSaved: boolean;
};

export type EditorSelection = {
  from: number;
  to: number;
};

type EditorState = {
  tabs: EditorTab[];
  activeTabId: string | null;
  activeTabIdByConnection: Record<string, string | null>;
  selection: EditorSelection | null;
  createTab: (input?: Partial<EditorTab>) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setActiveConnection: (connectionId: string | null) => void;
  setContent: (id: string, content: string) => void;
  setSelection: (sel: EditorSelection | null) => void;
  renameTab: (id: string, name: string) => void;
  markSaved: (id: string, fileName?: string, connectionId?: string | null, database?: string) => void;
};

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function connKey(connectionId: string | null): string {
  return connectionId ?? "__none__";
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [
    {
      id: "tab-1",
      name: "Query 1",
      content: "SELECT 1;",
      connectionId: null,
      database: "",
      isSaved: true,
    },
  ],
  activeTabId: "tab-1",
  activeTabIdByConnection: { __none__: "tab-1" },
  selection: null,

  createTab: (input) => {
    const id = `tab-${uid()}`;
    const connectionId = input?.connectionId ?? null;
    const tab: EditorTab = {
      id,
      name: input?.name ?? `Query ${get().tabs.length + 1}`,
      content: input?.content ?? "",
      connectionId,
      database: input?.database ?? "",
      fileName: input?.fileName,
      isSaved: input?.isSaved ?? false,
    };
    const key = connKey(connectionId);
    set((s) => ({ tabs: [tab, ...s.tabs], activeTabId: id, activeTabIdByConnection: { ...s.activeTabIdByConnection, [key]: id } }));
  },

  closeTab: (id) => {
    set((s) => {
      const closing = s.tabs.find((t) => t.id === id) ?? null;
      const nextTabs = s.tabs.filter((t) => t.id !== id);
      const key = connKey(closing?.connectionId ?? null);

      const isClosingActive = s.activeTabId === id;
      if (!isClosingActive) {
        const mapping = s.activeTabIdByConnection[key] === id ? null : s.activeTabIdByConnection[key] ?? null;
        return {
          tabs: nextTabs,
          activeTabId: s.activeTabId,
          activeTabIdByConnection: mapping === s.activeTabIdByConnection[key] ? s.activeTabIdByConnection : { ...s.activeTabIdByConnection, [key]: mapping },
          selection: null,
        };
      }

      const sameConnTabs = nextTabs.filter((t) => connKey(t.connectionId) === key);
      const nextActive = sameConnTabs[0]?.id ?? null;
      return {
        tabs: nextTabs,
        activeTabId: nextActive,
        activeTabIdByConnection: { ...s.activeTabIdByConnection, [key]: nextActive },
        selection: null,
      };
    });
  },

  setActive: (id) => {
    const tab = get().tabs.find((t) => t.id === id) ?? null;
    const key = connKey(tab?.connectionId ?? null);
    set((s) => ({ activeTabId: id, activeTabIdByConnection: { ...s.activeTabIdByConnection, [key]: id }, selection: null }));
  },

  setActiveConnection: (connectionId) => {
    const key = connKey(connectionId);
    const mapped = get().activeTabIdByConnection[key] ?? null;
    if (mapped && get().tabs.some((t) => t.id === mapped)) {
      set({ activeTabId: mapped, selection: null });
      return;
    }
    const existing = get().tabs.find((t) => connKey(t.connectionId) === key) ?? null;
    if (existing) {
      set((s) => ({ activeTabId: existing.id, activeTabIdByConnection: { ...s.activeTabIdByConnection, [key]: existing.id }, selection: null }));
      return;
    }
    get().createTab({ content: "", connectionId, database: "" });
  },

  setContent: (id, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content, isSaved: false } : t)),
    }));
  },

  setSelection: (sel) => set({ selection: sel }),

  renameTab: (id, name) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)) }));
  },

  markSaved: (id, fileName, connectionId, database) => {
    set((s) => {
      const current = s.tabs.find((t) => t.id === id) ?? null;
      const nextConnectionId = connectionId ?? current?.connectionId ?? null;
      const oldKey = connKey(current?.connectionId ?? null);
      const nextKey = connKey(nextConnectionId);
      const nextActiveByConn = { ...s.activeTabIdByConnection, [nextKey]: id };
      if (oldKey !== nextKey && s.activeTabIdByConnection[oldKey] === id) nextActiveByConn[oldKey] = null;
      return {
        tabs: s.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                isSaved: true,
                fileName: fileName ?? t.fileName,
                connectionId: nextConnectionId,
                database: database ?? t.database,
              }
            : t
        ),
        activeTabIdByConnection: nextActiveByConn,
      };
    });
  },
}));
