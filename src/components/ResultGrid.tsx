import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import clsx from "clsx";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { useQueryStore } from "../stores/queryStore";
import type { JsonValue, RowKey } from "../types/query";
import { useConnectionStore } from "../stores/connectionStore";
import { rewriteLimitOffset } from "../utils/sql";
import { useEditorStore } from "../stores/editorStore";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";

function toDisplay(v: JsonValue): string {
  if (v === null) return "NULL";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `Array(${v.length})`;
  return "{…}";
}

function parseInput(s: string): JsonValue {
  const trimmed = s.trim();
  if (!trimmed) return "";
  if (trimmed.toUpperCase() === "NULL") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const n = Number(trimmed);
  if (Number.isFinite(n) && String(n) === trimmed) return n;
  return s;
}

type GridColumn =
  | { key: "__select__"; kind: "select"; width: number }
  | { key: string; kind: "data"; name: string; dataType: string; width: number; colIndex: number };

export function ResultGrid() {
  const { result, error, running, dirty, setCell, toggleSelect, selectAll, clearSelection, markDeleted, undoDelete, addInsertRow, setInsertCell, removeInsertRow, applySave, runQuery, lastQuery } = useQueryStore(
    useShallow((s) => ({
      result: s.result,
      error: s.error,
      running: s.running,
      dirty: s.dirty,
      setCell: s.setCell,
      toggleSelect: s.toggleSelect,
      selectAll: s.selectAll,
      clearSelection: s.clearSelection,
      markDeleted: s.markDeleted,
      undoDelete: s.undoDelete,
      addInsertRow: s.addInsertRow,
      setInsertCell: s.setInsertCell,
      removeInsertRow: s.removeInsertRow,
      applySave: s.applySave,
      runQuery: s.runQuery,
      lastQuery: s.lastQuery,
    })),
  );
  const { activeConnectionId } = useConnectionStore();
  const { tabs, activeTabId } = useEditorStore();
  const [editing, setEditing] = useState<{ key: string; col: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const cols = result?.columns ?? [];
  const editable = result?.editable?.enabled && !!result.editable.table && (result.editable.primary_key_columns?.length ?? 0) > 0;
  const pkCols = result?.editable?.primary_key_columns ?? [];

  const colIndexByName = useMemo(() => Object.fromEntries(cols.map((c, i) => [c.name, i])) as Record<string, number>, [cols]);

  const canKey = useMemo(() => pkCols.every((c) => colIndexByName[c] != null), [pkCols, colIndexByName]);

  const rowKeys: RowKey[] = useMemo(() => {
    if (!result || !editable || !canKey) return [];
    return result.rows.map((r) => pkCols.map((c) => r[colIndexByName[c]] ?? null));
  }, [result, editable, canKey, pkCols, colIndexByName]);

  const hasDirty = dirty.inserts.length > 0 || Object.keys(dirty.updatesByKey).length > 0 || Object.keys(dirty.deletesByKey).length > 0;

  const pagination = result?.pagination;
  const limit = pagination?.limit;
  const offset = pagination?.offset;
  const pageSize = limit ?? pagination?.page_size;
  const currentPage = pageSize != null && offset != null ? Math.floor(offset / pageSize) + 1 : null;

  const insertCount = editable ? dirty.inserts.length : 0;
  const dataCount = result?.rows.length ?? 0;
  const rowCount = insertCount + dataCount;

  const gridColumns: GridColumn[] = useMemo(() => {
    const dataCols: GridColumn[] = cols.map((c, idx) => ({
      key: c.name,
      kind: "data",
      name: c.name,
      dataType: c.data_type,
      width: 220,
      colIndex: idx,
    }));
    return [{ key: "__select__", kind: "select", width: 44 }, ...dataCols];
  }, [cols]);

  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: gridColumns.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (i) => gridColumns[i]?.width ?? 220,
    overscan: 3,
  });

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 36,
    overscan: 16,
  });

  const totalWidth = colVirtualizer.getTotalSize();
  const totalHeight = rowVirtualizer.getTotalSize();
  const headerHeight = 36;

  return (
    <div className="flex h-[56%] min-h-0 flex-col bg-[color:var(--result-bg)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="text-xs text-zinc-400">Results</div>
          {running ? <div className="text-xs text-zinc-500">Running…</div> : null}
        </div>

        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">Rows returned: {result?.row_count ?? 0}</span>
          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">Total records: {result?.total_records ?? "—"}</span>
        </div>
      </div>

      {error ? (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 size-4" />
          <div className="min-w-0">
            <div className="font-medium">Query failed</div>
            <div className="mt-1 whitespace-pre-wrap break-words text-xs text-red-100/90">{error}</div>
          </div>
        </div>
      ) : null}

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ width: totalWidth, minHeight: headerHeight + totalHeight }}>
          <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0f0f14]" style={{ height: headerHeight }}>
            <div style={{ position: "relative", width: totalWidth, height: headerHeight }}>
              {colVirtualizer.getVirtualItems().map((vCol) => {
                const col = gridColumns[vCol.index];
                if (!col) return null;
                if (col.kind === "select") {
                  return (
                    <div
                      key={col.key}
                      style={{ position: "absolute", top: 0, left: vCol.start, width: vCol.size, height: headerHeight, display: "flex", alignItems: "center" }}
                      className="px-3"
                    >
                      {editable && canKey ? (
                        <input
                          type="checkbox"
                          onChange={(e) => {
                            if (e.currentTarget.checked) selectAll(rowKeys);
                            else clearSelection();
                          }}
                        />
                      ) : null}
                    </div>
                  );
                }
                return (
                  <div
                    key={col.key}
                    style={{ position: "absolute", top: 0, left: vCol.start, width: vCol.size, height: headerHeight, display: "flex", alignItems: "center" }}
                    className="px-3"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-zinc-200">{col.name}</span>
                      <span className="shrink-0 rounded bg-white/6 px-1.5 py-0.5 text-[10px] font-normal text-zinc-400">{col.dataType}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ position: "relative", height: totalHeight }}>
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const isInsert = editable && vRow.index < insertCount;
              const dataIdx = isInsert ? -1 : vRow.index - insertCount;
              const row = !isInsert && result ? result.rows[dataIdx] : null;

              const key = !isInsert ? rowKeys[dataIdx] : null;
              const keyStr = key ? JSON.stringify(key) : null;
              const isDeleted = keyStr ? !!dirty.deletesByKey[keyStr] : false;
              const isSelected = keyStr ? !!dirty.selectedKeys[keyStr] : false;

              const zebra = isInsert ? "bg-emerald-500/6" : dataIdx % 2 === 0 ? "bg-white/0" : "bg-white/2";

              return (
                <div
                  key={vRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: totalWidth,
                    height: 36,
                    transform: `translateY(${vRow.start}px)`,
                    willChange: "transform",
                  }}
                  className={clsx("border-b border-white/10", zebra, isDeleted && "opacity-55")}
                >
                  <div style={{ position: "relative", width: totalWidth, height: 36 }}>
                    {colVirtualizer.getVirtualItems().map((vCol) => {
                      const col = gridColumns[vCol.index];
                      if (!col) return null;

                      if (col.kind === "select") {
                        return (
                          <div
                            key={`${vRow.key}-${col.key}`}
                            style={{ position: "absolute", top: 0, left: vCol.start, width: vCol.size, height: 36, display: "flex", alignItems: "center" }}
                            className="px-3"
                          >
                            {isInsert ? (
                              <button
                                className="text-xs text-zinc-400 hover:text-zinc-200"
                                onClick={() => {
                                  const ins = dirty.inserts[vRow.index];
                                  if (ins) removeInsertRow(ins.id);
                                }}
                                title="Remove new row"
                              >
                                ×
                              </button>
                            ) : editable && canKey && key ? (
                              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(key)} />
                            ) : null}
                          </div>
                        );
                      }

                      if (isInsert) {
                        const ins = dirty.inserts[vRow.index];
                        const value = ins?.values?.[col.name];
                        return (
                          <div
                            key={`${vRow.key}-${col.key}`}
                            style={{ position: "absolute", top: 0, left: vCol.start, width: vCol.size, height: 36, display: "flex", alignItems: "center" }}
                            className="px-3"
                          >
                            <Input
                              className="h-8"
                              value={value == null ? "" : String(value)}
                              placeholder="NULL"
                              onChange={(e) => {
                                if (!ins) return;
                                setInsertCell(ins.id, col.name, parseInput(e.currentTarget.value));
                              }}
                            />
                          </div>
                        );
                      }

                      const isPk = pkCols.includes(col.name);
                      const canEditCell = editable && canKey && key && !isDeleted && !isPk;
                      const cellKey = keyStr ? { key: keyStr, col: col.name } : null;
                      const isEditing = !!cellKey && editing?.key === cellKey.key && editing?.col === cellKey.col;
                      const display = toDisplay(row?.[col.colIndex] ?? null);

                      return (
                        <div
                          key={`${vRow.key}-${col.key}`}
                          style={{ position: "absolute", top: 0, left: vCol.start, width: vCol.size, height: 36, display: "flex", alignItems: "center" }}
                          className={clsx("px-3", isPk && "text-zinc-300", canEditCell && "cursor-text")}
                          onDoubleClick={() => {
                            if (!canEditCell || !cellKey) return;
                            setEditing(cellKey);
                          }}
                        >
                          {isEditing && canEditCell && key ? (
                            <Input
                              autoFocus
                              className="h-8"
                              defaultValue={display === "NULL" ? "" : display}
                              onBlur={(e) => {
                                setCell(key, col.name, parseInput(e.currentTarget.value));
                                setEditing(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                          ) : (
                            <div className={clsx("w-full truncate", display === "NULL" && "italic text-zinc-500")} title={display}>
                              {display}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {editable ? (
              <Button size="sm" variant="ghost" onClick={() => addInsertRow()}>
                <Plus className="size-4" />
                Add row
              </Button>
            ) : null}

            {editable && canKey ? (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  const keys = Object.keys(dirty.selectedKeys);
                  for (const ks of keys) {
                    markDeleted(JSON.parse(ks) as RowKey);
                  }
                  clearSelection();
                }}
                disabled={Object.keys(dirty.selectedKeys).length === 0}
              >
                <Trash2 className="size-4" />
                Delete selected
              </Button>
            ) : null}

            {editable && canKey ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  for (const ks of Object.keys(dirty.deletesByKey)) {
                    undoDelete(JSON.parse(ks) as RowKey);
                  }
                }}
                disabled={Object.keys(dirty.deletesByKey).length === 0}
              >
                Undo deletes
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {pageSize != null && offset != null && currentPage != null ? (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">Page {currentPage}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!activeConnectionId) return;
                    const nextOffset = Math.max(0, offset - pageSize);
                    const nextQuery = rewriteLimitOffset(lastQuery || activeTab?.content || "", { limit: pageSize, offset: nextOffset });
                    await runQuery({ connectionId: activeConnectionId, query: nextQuery });
                  }}
                  disabled={!activeConnectionId || offset <= 0}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!activeConnectionId) return;
                    const nextOffset = offset + pageSize;
                    const nextQuery = rewriteLimitOffset(lastQuery || activeTab?.content || "", { limit: pageSize, offset: nextOffset });
                    await runQuery({ connectionId: activeConnectionId, query: nextQuery });
                  }}
                  disabled={!activeConnectionId}
                >
                  Next
                </Button>
              </div>
            ) : null}

            <Button
              size="sm"
              onClick={async () => {
                if (!activeConnectionId) return;
                if (!editable) return;
                if (!hasDirty) return;
                if (!window.confirm("Apply INSERT/UPDATE/DELETE changes now?")) return;
                setSaving(true);
                try {
                  await applySave({ connectionId: activeConnectionId });
                  const q = lastQuery || activeTab?.content || "";
                  await runQuery({ connectionId: activeConnectionId, query: q });
                } finally {
                  setSaving(false);
                }
              }}
              disabled={!activeConnectionId || !editable || !hasDirty || saving}
            >
              <Save className="size-4" />
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        </div>

        {!editable && result?.editable?.reason_disabled ? (
          <div className="mt-2 text-xs text-zinc-500">Read-only: {result.editable.reason_disabled}</div>
        ) : null}
      </div>
    </div>
  );
}
