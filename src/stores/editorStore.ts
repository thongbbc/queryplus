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
  selection: EditorSelection | null;
  createTab: (input?: Partial<EditorTab>) => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setContent: (id: string, content: string) => void;
  setSelection: (sel: EditorSelection | null) => void;
  renameTab: (id: string, name: string) => void;
  markSaved: (id: string, fileName?: string) => void;
};

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
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
  selection: null,

  createTab: (input) => {
    const id = `tab-${uid()}`;
    const tab: EditorTab = {
      id,
      name: input?.name ?? `Query ${get().tabs.length + 1}`,
      content: input?.content ?? "",
      connectionId: input?.connectionId ?? null,
      database: input?.database ?? "",
      fileName: input?.fileName,
      isSaved: input?.isSaved ?? false,
    };
    set((s) => ({ tabs: [tab, ...s.tabs], activeTabId: id }));
  },

  closeTab: (id) => {
    set((s) => {
      const nextTabs = s.tabs.filter((t) => t.id !== id);
      const nextActive = s.activeTabId === id ? nextTabs[0]?.id ?? null : s.activeTabId;
      return { tabs: nextTabs, activeTabId: nextActive, selection: null };
    });
  },

  setActive: (id) => set({ activeTabId: id, selection: null }),

  setContent: (id, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content, isSaved: false } : t)),
    }));
  },

  setSelection: (sel) => set({ selection: sel }),

  renameTab: (id, name) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)) }));
  },

  markSaved: (id, fileName) => {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, isSaved: true, fileName: fileName ?? t.fileName } : t)) }));
  },
}));
