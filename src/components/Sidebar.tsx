import { useEffect, useMemo, useState } from "react";
import { Database, PlugZap, Plus, Unplug, X } from "lucide-react";
import clsx from "clsx";
import { useConnectionStore } from "../stores/connectionStore";
import type { ConnectionConfig } from "../types/connection";
import { Button } from "./ui/Button";
import { ConnectionModal } from "./ConnectionModal";

function dbDotClass(dbType: ConnectionConfig["db_type"]) {
  if (dbType === "postgres") return "bg-[var(--postgres-color)]";
  if (dbType === "mysql") return "bg-[var(--mysql-color)]";
  return "bg-[var(--mariadb-color)]";
}

export function Sidebar() {
  const { connections, activeConnectionId, setActive, statusById, errorById, connect, disconnect, remove, save, listDatabases, setDatabase } = useConnectionStore();
  const [modalOpen, setModalOpen] = useState(false);
  const active = useMemo(() => connections.find((c) => c.id === activeConnectionId) ?? null, [connections, activeConnectionId]);
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const activeStatus = active ? (statusById[active.id] ?? "disconnected") : "disconnected";
  const shouldShowDbList = !!active && activeStatus === "connected";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!active || !shouldShowDbList) {
        setDatabases(null);
        setDbError(null);
        return;
      }
      setDbLoading(true);
      setDbError(null);
      try {
        const items = await listDatabases(active.id);
        if (cancelled) return;
        setDatabases(items);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (cancelled) return;
        setDbError(message);
        setDatabases(null);
      } finally {
        if (!cancelled) setDbLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [active?.id, shouldShowDbList, listDatabases]);

  return (
    <aside className="flex h-full w-[280px] flex-col border-r border-white/10 bg-[color:var(--sidebar-bg)]">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-white/5">
            <Database className="size-4 text-zinc-200" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">QueryPlus</div>
            <div className="text-xs text-zinc-400">Connections</div>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setModalOpen(true)}>
          <Plus className="size-4" />
          New
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-2 pb-2">
        <div className="space-y-1">
          {connections.map((c) => {
            const status = statusById[c.id] ?? "disconnected";
            const isActive = c.id === activeConnectionId;
            return (
              <div
                key={c.id}
                className={clsx(
                  "group rounded-lg border border-transparent px-2 py-2 transition",
                  isActive ? "bg-white/6" : "hover:bg-[color:var(--sidebar-hover)]",
                )}
              >
                <button className="flex w-full items-center gap-3" onClick={() => setActive(c.id)}>
                  <span className={clsx("mt-0.5 size-2 shrink-0 rounded-full", dbDotClass(c.db_type), status === "connected" ? "opacity-100" : "opacity-50")} />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium text-zinc-100">{c.name}</div>
                    <div className="truncate text-xs text-zinc-400">
                      {c.db_type} · {c.host}:{c.port} · {status}
                    </div>
                  </div>
                </button>

                {errorById[c.id] ? <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-100">{errorById[c.id]}</div> : null}

                <div className="mt-2 flex items-center gap-2">
                  {status !== "connected" ? (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await connect(c.id);
                      }}
                      disabled={status === "connecting"}
                      className="w-full"
                    >
                      <PlugZap className="size-4" />
                      {status === "connecting" ? "Connecting" : "Connect"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await disconnect(c.id);
                      }}
                      className="w-full"
                    >
                      <Unplug className="size-4" />
                      Disconnect
                    </Button>
                  )}

                  <button
                    className="grid size-8 place-items-center rounded-md border border-white/10 bg-white/0 text-zinc-400 opacity-0 transition hover:bg-white/5 hover:text-zinc-200 group-hover:opacity-100"
                    onClick={async () => {
                      await disconnect(c.id).catch(() => undefined);
                      remove(c.id);
                      await save();
                    }}
                    title="Remove"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        {shouldShowDbList ? (
          <div className="mb-3">
            <div className="mb-2 text-xs font-medium text-zinc-300">Database</div>
            {dbLoading ? <div className="text-xs text-zinc-500">Loading…</div> : null}
            {dbError ? <div className="mt-1 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-100">{dbError}</div> : null}
            {databases && databases.length > 0 ? (
              <div className="mt-2 max-h-[180px] overflow-auto rounded-lg border border-white/10 bg-white/3 p-1">
                <button
                  className={clsx(
                    "w-full truncate rounded-md px-2 py-1 text-left text-xs hover:bg-white/6",
                    active?.database.trim() === "" ? "text-zinc-100" : "text-zinc-300",
                  )}
                  onClick={async () => {
                    if (!active) return;
                    await setDatabase(active.id, "");
                    await disconnect(active.id).catch(() => undefined);
                    await connect(active.id);
                  }}
                  title="All databases"
                >
                  (All databases)
                </button>
                {databases.map((db) => (
                  <button
                    key={db}
                    className={clsx(
                      "w-full truncate rounded-md px-2 py-1 text-left text-xs hover:bg-white/6",
                      active?.database === db ? "text-zinc-100" : "text-zinc-200",
                    )}
                    onClick={async () => {
                      if (!active) return;
                      await setDatabase(active.id, db);
                      await disconnect(active.id).catch(() => undefined);
                      await connect(active.id);
                    }}
                    title={`Connect to ${db}`}
                  >
                    {db}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="text-xs text-zinc-500">Active: {active?.name ?? "None"}</div>
      </div>

      <ConnectionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </aside>
  );
}
