import { Minus, Square, X } from "lucide-react";
import { useMemo } from "react";
import { useConnectionStore } from "../stores/connectionStore";

function isTauriRuntime(): boolean {
  const w = window as unknown as Record<string, unknown>;
  const internals = w["__TAURI_INTERNALS__"] as { invoke?: unknown } | undefined;
  return typeof internals?.invoke === "function";
}

export function TitleBar() {
  const { activeConnectionId, connections, statusById } = useConnectionStore();
  const active = useMemo(() => connections.find((c) => c.id === activeConnectionId) ?? null, [connections, activeConnectionId]);
  const status = active ? (statusById[active.id] ?? "disconnected") : "disconnected";
  const tauri = isTauriRuntime();

  return (
    <div
      className="relative flex h-11 select-none items-center gap-3 border-b border-white/10 bg-[#0f0f14] px-3"
      data-tauri-drag-region
      onMouseDown={async (e) => {
        if (!tauri) return;
        if (e.button !== 0) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest("[data-window-control]")) return;
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().startDragging();
      }}
      onDoubleClick={async () => {
        if (!tauri) return;
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().toggleMaximize();
      }}
    >
      <div className="flex items-center gap-2">
        <div className="grid size-8 place-items-center rounded-lg bg-white/6">
          <div className="size-2 rounded-full bg-blue-500" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">
            QueryPlus
          </div>
          <div className="truncate text-[11px] text-zinc-500">
            {active ? `${active.name} · ${status}` : "No active connection"}
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1" data-window-control>
        <button
          className="grid size-9 place-items-center rounded-md text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          onClick={async () => {
            if (!tauri) return;
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().minimize();
          }}
          title="Minimize"
          disabled={!tauri}
          data-window-control
        >
          <Minus className="size-4" />
        </button>
        <button
          className="grid size-9 place-items-center rounded-md text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          onClick={async () => {
            if (!tauri) return;
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().toggleMaximize();
          }}
          title="Maximize"
          disabled={!tauri}
          data-window-control
        >
          <Square className="size-4" />
        </button>
        <button
          className="grid size-9 place-items-center rounded-md text-zinc-400 hover:bg-red-500/15 hover:text-red-200"
          onClick={async () => {
            if (!tauri) return;
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().close();
          }}
          title="Close"
          disabled={!tauri}
          data-window-control
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
