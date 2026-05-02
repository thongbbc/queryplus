import { Play, PlayCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/Button";
import { useConnectionStore } from "../stores/connectionStore";
import { useEditorStore } from "../stores/editorStore";
import { useQueryStore } from "../stores/queryStore";
import { extractSelectedOrStatement } from "../utils/sql";

export function Toolbar() {
  const { activeConnectionId, connections, statusById, listDatabases, setDatabase, connect, disconnect } = useConnectionStore();
  const { tabs, activeTabId, selection } = useEditorStore();
  const { runningById, runQuery, cancelQuery } = useQueryStore();
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeConn = connections.find((c) => c.id === activeConnectionId) ?? null;
  const status = activeConn ? (statusById[activeConn.id] ?? "disconnected") : "disconnected";
  const running = activeConnectionId ? (runningById[activeConnectionId] ?? false) : false;
  const [dbItems, setDbItems] = useState<string[]>([]);
  const [dbLoading, setDbLoading] = useState(false);

  const canSwitchDb = !!activeConn && status === "connected";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeConn || status !== "connected") {
        setDbItems([]);
        return;
      }
      setDbLoading(true);
      try {
        const items = await listDatabases(activeConn.id);
        if (!cancelled) setDbItems(items);
      } finally {
        if (!cancelled) setDbLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeConn?.id, status, listDatabases]);

  const runSql = useMemo(() => {
    const content = activeTab?.content ?? "";
    const q = extractSelectedOrStatement(content, selection);
    return q;
  }, [activeTab?.content, selection]);

  return (
    <div className="flex items-center gap-3 border-b border-white/10 bg-[#0f0f14]/70 px-4 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={async () => {
            if (!activeConnectionId) return;
            if (status !== "connected") return;
            const q = runSql;
            if (!q.trim()) return;
            try {
              await runQuery({ connectionId: activeConnectionId, query: q });
            } catch {
              return;
            }
          }}
          disabled={!activeConnectionId || running || status !== "connected"}
        >
          <Play className="size-4" />
          Run
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            if (!activeConnectionId) return;
            if (status !== "connected") return;
            await runQuery({ connectionId: activeConnectionId, query: activeTab?.content ?? "" });
          }}
          disabled={!activeConnectionId || running || status !== "connected"}
        >
          <PlayCircle className="size-4" />
          Run All
        </Button>
        {running ? (
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (!activeConnectionId) return;
              cancelQuery(activeConnectionId);
            }}
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm5 0h2v12h-2zm5 0h2v12h-2z" />
            </svg>
            Cancel
          </Button>
        ) : null}
      </div>
      <div className="ml-2 flex items-center gap-2 text-xs text-zinc-400">
        <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">{activeConn ? `${activeConn.db_type} · ${activeConn.host}:${activeConn.port}` : "No connection"}</span>
        {activeConn ? (
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">DB: {activeConn.database?.trim() ? activeConn.database : "(all)"}</span>
        ) : null}
      </div>

      {activeConn ? (
        <div className="ml-2 flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-zinc-300/50 bg-white px-2 text-xs text-black disabled:opacity-60"
            value={activeConn.database}
            disabled={!canSwitchDb || dbLoading}
            onChange={async (e) => {
              const nextDb = e.currentTarget.value;
              await setDatabase(activeConn.id, nextDb);
              await disconnect(activeConn.id).catch(() => undefined);
              await connect(activeConn.id);
            }}
          >
            <option value="">(All databases)</option>
            {dbItems.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        </div>
      ) : null}

    </div>
  );
}
