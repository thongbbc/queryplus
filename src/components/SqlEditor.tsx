import { useEffect, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { useEditorStore } from "../stores/editorStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useQueryStore } from "../stores/queryStore";
import { extractSelectedOrStatement } from "../utils/sql";

export function SqlEditor() {
  const { tabs, activeTabId, setContent, setSelection } = useEditorStore();
  const { activeConnectionId, statusById } = useConnectionStore();
  const { runQuery } = useQueryStore();
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  const canRun = !!activeConnectionId && (statusById[activeConnectionId] ?? "disconnected") === "connected";

  const extensions = useMemo(() => {
    return [
      sql(),
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet) return;
        const sel = update.state.selection.main;
        setSelection({ from: sel.from, to: sel.to });
      }),
      keymap.of([
        {
          key: "Ctrl-Enter",
          run: () => {
            const view = cmRef.current?.view;
            if (!view || !activeConnectionId || !canRun) return true;
            const sel = view.state.selection.main;
            const full = view.state.sliceDoc(0, view.state.doc.length);
            const query = extractSelectedOrStatement(full, { from: sel.from, to: sel.to });
            if (!query.trim()) return true;
            void runQuery({ connectionId: activeConnectionId, query });
            return true;
          },
        },
        {
          key: "Mod-Enter",
          run: () => {
            const view = cmRef.current?.view;
            if (!view || !activeConnectionId || !canRun) return true;
            const sel = view.state.selection.main;
            const full = view.state.sliceDoc(0, view.state.doc.length);
            const query = extractSelectedOrStatement(full, { from: sel.from, to: sel.to });
            if (!query.trim()) return true;
            void runQuery({ connectionId: activeConnectionId, query });
            return true;
          },
        },
        {
          key: "Ctrl-Shift-Enter",
          run: () => {
            const view = cmRef.current?.view;
            if (!view || !activeConnectionId || !canRun) return true;
            void runQuery({ connectionId: activeConnectionId, query: view.state.sliceDoc(0, view.state.doc.length) });
            return true;
          },
        },
        {
          key: "Shift-Mod-Enter",
          run: () => {
            const view = cmRef.current?.view;
            if (!view || !activeConnectionId || !canRun) return true;
            void runQuery({ connectionId: activeConnectionId, query: view.state.sliceDoc(0, view.state.doc.length) });
            return true;
          },
        },
      ]),
    ];
  }, [activeConnectionId, canRun, runQuery, setSelection]);

  useEffect(() => {
    const view = cmRef.current?.view;
    if (!view) return;
    view.focus();
  }, [activeTabId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!canRun) return;
      if (!e.ctrlKey || e.key !== "Enter") return;
      const view = cmRef.current?.view;
      if (!view || !view.hasFocus) return;
      e.preventDefault();
      const sel = view.state.selection.main;
      const full = view.state.sliceDoc(0, view.state.doc.length);
      const q = extractSelectedOrStatement(full, { from: sel.from, to: sel.to });
      if (!q.trim() || !activeConnectionId) return;
      void runQuery({ connectionId: activeConnectionId, query: q });
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeConnectionId, canRun, runQuery]);

  return (
    <div className="flex h-[44%] min-h-[240px] flex-col border-b border-white/10 bg-[color:var(--editor-bg)]">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="text-xs text-zinc-400">SQL Editor</div>
        <div className="text-xs text-zinc-500">Ctrl+Enter run selection · Ctrl+Shift+Enter run all</div>
      </div>
      <div className="min-h-0 flex-1">
        <CodeMirror
          ref={cmRef}
          value={activeTab?.content ?? ""}
          theme={oneDark}
          height="100%"
          extensions={extensions}
          basicSetup={{ lineNumbers: true, foldGutter: false }}
          onChange={(val) => {
            if (!activeTabId) return;
            setContent(activeTabId, val);
          }}
        />
      </div>
    </div>
  );
}
