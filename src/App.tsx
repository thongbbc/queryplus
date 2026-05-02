import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { SqlEditor } from "./components/SqlEditor";
import { ResultGrid } from "./components/ResultGrid";
import { StatusBar } from "./components/StatusBar";
import { useConnectionStore } from "./stores/connectionStore";
import { ScriptTabs } from "./components/ScriptTabs";
import { DialogHost } from "./components/DialogHost";

export default function App() {
  const { load, activeConnectionId, statusById } = useConnectionStore();
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<
    | null
    | { kind: "sidebar"; startX: number; start: number }
    | { kind: "editor"; startY: number; start: number; total: number }
  >(null);

  const isConnected = useMemo(() => {
    if (!activeConnectionId) return false;
    return (statusById[activeConnectionId] ?? "disconnected") === "connected";
  }, [activeConnectionId, statusById]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "sidebar") {
        const next = d.start + (e.clientX - d.startX);
        setSidebarWidth(Math.max(220, Math.min(520, next)));
      } else {
        const next = d.start + (e.clientY - d.startY);
        const editorMin = 220;
        const resultMin = 220;
        const maxEditor = Math.max(editorMin, d.total - resultMin);
        setEditorHeight(Math.max(editorMin, Math.min(maxEditor, next)));
      }
      document.body.style.userSelect = "none";
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    if (editorHeight != null) return;
    const el = splitRef.current;
    if (!el) return;
    const h = el.clientHeight;
    if (h <= 0) return;
    setEditorHeight(Math.max(260, Math.floor(h * 0.48)));
  }, [isConnected, editorHeight]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="shrink-0" style={{ width: sidebarWidth }}>
          <Sidebar />
        </div>
        <div
          className="w-1 shrink-0 cursor-col-resize bg-white/5 hover:bg-white/10"
          onMouseDown={(e) => {
            dragRef.current = { kind: "sidebar", startX: e.clientX, start: sidebarWidth };
          }}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {isConnected ? (
            <>
              <Toolbar />
              <ScriptTabs />
              <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0" style={{ height: editorHeight ?? undefined }}>
                  <SqlEditor />
                </div>
                <div
                  className="h-2 cursor-row-resize border-y border-white/10 bg-white/3 hover:bg-white/6"
                  onMouseDown={(e) => {
                    const el = splitRef.current;
                    if (!el) return;
                    const total = el.clientHeight;
                    const start = editorHeight ?? Math.floor(total * 0.48);
                    dragRef.current = { kind: "editor", startY: e.clientY, start, total };
                  }}
                />
                <div className="flex min-h-0 flex-1 flex-col">
                  <ResultGrid />
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <div className="max-w-md rounded-xl border border-white/10 bg-white/3 p-6 text-center">
                <div className="text-sm font-semibold text-zinc-100">Connect a database to start</div>
                <div className="mt-2 text-sm text-zinc-400">Create a connection in the left sidebar, then click Connect. The editor and results appear after a successful connection.</div>
              </div>
            </div>
          )}
          <StatusBar />
        </div>
      </div>
      <DialogHost />
    </div>
  );
}
