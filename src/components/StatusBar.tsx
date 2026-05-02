import { useConnectionStore } from "../stores/connectionStore";
import { useQueryStore } from "../stores/queryStore";

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
        <span>{result ? `${result.execution_time_ms}ms` : "—"}</span>
      </div>
    </div>
  );
}
