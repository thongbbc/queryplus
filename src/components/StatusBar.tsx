import { useConnectionStore } from "../stores/connectionStore";
import { useQueryStore } from "../stores/queryStore";

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
}

export function StatusBar() {
  const { activeConnectionId, statusById, connections } = useConnectionStore();
  const { resultById } = useQueryStore();
  const conn = connections.find((c) => c.id === activeConnectionId) ?? null;
  const status = activeConnectionId ? statusById[activeConnectionId] : "disconnected";
  const result = activeConnectionId ? resultById[activeConnectionId] ?? null : null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#0f0f14]/60 px-4 py-2 text-xs text-zinc-400">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${status === "connected" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-red-400"}`} />
        <span>{conn ? `${conn.name} (${conn.db_type})` : "No connection"}</span>
      </div>
      <div className="flex items-center gap-2">
        <span>Rows: {result?.row_count ?? 0}</span>
        <span>·</span>
        <span>{result ? formatDuration(result.execution_time_ms) : "—"}</span>
      </div>
    </div>
  );
}
