import { useMemo, useState } from "react";
import { PlugZap, Plus, Settings, Unplug } from "lucide-react";
import clsx from "clsx";
import { useConnectionStore } from "../stores/connectionStore";
import type { ConnectionConfig } from "../types/connection";
import { Button } from "./ui/Button";
import { ConnectionModal } from "./ConnectionModal";
import logo from "../assets/logo-mark.svg";

function dbDotClass(dbType: ConnectionConfig["db_type"]) {
  if (dbType === "postgres") return "bg-[var(--postgres-color)]";
  if (dbType === "mysql") return "bg-[var(--mysql-color)]";
  return "bg-[var(--mariadb-color)]";
}

export function Sidebar() {
  const { connections, activeConnectionId, setActive, statusById, errorById, connect, disconnect } = useConnectionStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const active = useMemo(() => connections.find((c) => c.id === activeConnectionId) ?? null, [connections, activeConnectionId]);
  const editing = useMemo(() => (editId ? connections.find((c) => c.id === editId) ?? null : null), [connections, editId]);

  const activeStatus = active ? (statusById[active.id] ?? "disconnected") : "disconnected";

  return (
    <aside className="flex h-full w-full flex-col bg-[color:var(--sidebar-bg)]">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <img src={logo} alt="QueryPlus" className="size-8" draggable={false} />
          <div>
            <div className="text-sm font-semibold text-zinc-100">QueryPlus</div>
            <div className="text-xs text-zinc-400">Connections</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditId(null);
            setModalOpen(true);
          }}
        >
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
                  "group relative rounded-lg border px-2 py-2 transition",
                  isActive
                    ? "border-sky-400/50 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.12)]"
                    : "border-white/10 hover:bg-[color:var(--sidebar-hover)] hover:border-white/15",
                )}
              >
                <button className="flex w-full items-center gap-3" onClick={() => setActive(c.id)}>
                  <span className={clsx("mt-0.5 size-2 shrink-0 rounded-full", dbDotClass(c.db_type), status === "connected" ? "opacity-100" : "opacity-50")} />
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">{c.name}</div>
                      {isActive ? (
                        <span className="relative -top-px inline-flex h-5 items-center rounded-md border border-sky-400/40 bg-sky-500/10 px-2 text-[10px] font-semibold leading-none text-sky-100">
                          Active
                        </span>
                      ) : null}
                      <button
                        className="grid size-7 place-items-center rounded-md border border-white/10 bg-white/0 text-zinc-400 opacity-0 transition hover:bg-white/5 hover:text-zinc-200 group-hover:opacity-100"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setActive(c.id);
                          setEditId(c.id);
                          setModalOpen(true);
                        }}
                        title="Edit connection"
                      >
                        <Settings className="size-4" />
                      </button>
                    </div>
                    <div className="truncate text-xs text-zinc-400">
                      {c.db_type} · {c.host}:{c.port} · {status}
                    </div>
                  </div>
                </button>

                {errorById[c.id] ? <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-100">{errorById[c.id]}</div> : null}

                <div className="mt-2 flex items-center justify-end gap-2">
                  {status !== "connected" ? (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await connect(c.id);
                      }}
                      disabled={status === "connecting"}
                      className="h-7 px-2.5 text-xs"
                    >
                      <PlugZap className="size-3.5" />
                      {status === "connecting" ? "Connecting" : "Connect"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await disconnect(c.id);
                      }}
                      className="h-7 px-2.5 text-xs"
                    >
                      <Unplug className="size-3.5" />
                      Disconnect
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <div className="text-xs text-zinc-500">Active: {active?.name ?? "None"}</div>
        <div className="mt-1 text-xs text-zinc-600">Status: {activeStatus}</div>
      </div>

      <ConnectionModal
        open={modalOpen}
        connection={editing}
        onClose={() => {
          setModalOpen(false);
          setEditId(null);
        }}
      />
    </aside>
  );
}
