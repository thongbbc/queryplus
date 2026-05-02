import { useEffect, useMemo } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { SqlEditor } from "./components/SqlEditor";
import { ResultGrid } from "./components/ResultGrid";
import { StatusBar } from "./components/StatusBar";
import { useConnectionStore } from "./stores/connectionStore";
import { TitleBar } from "./components/TitleBar";

export default function App() {
  const { load, activeConnectionId, statusById } = useConnectionStore();

  const isConnected = useMemo(() => {
    if (!activeConnectionId) return false;
    return (statusById[activeConnectionId] ?? "disconnected") === "connected";
  }, [activeConnectionId, statusById]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {isConnected ? (
            <>
              <Toolbar />
              <div className="min-h-0 flex-1">
                <SqlEditor />
                <ResultGrid />
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
    </div>
  );
}
