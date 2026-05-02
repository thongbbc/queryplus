import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
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
import { useDialogStore } from "../stores/dialogStore";

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
  | {
      key: string;
      kind: "data";
      name: string;
      dataType: string;
      width: number;
      colIndex: number;
    };

export function ResultGrid() {
  const {
    resultById,
    errorById,
    runningById,
    dirtyById,
    clearDirty,
    setCell,
    toggleSelect,
    selectAll,
    clearSelection,
    markDeleted,
    addInsertRow,
    setInsertCell,
    removeInsertRow,
    applySave,
    runQuery,
    lastQueryById,
  } = useQueryStore(
    useShallow((s) => ({
      resultById: s.resultById,
      errorById: s.errorById,
      runningById: s.runningById,
      dirtyById: s.dirtyById,
      clearDirty: s.clearDirty,
      setCell: s.setCell,
      toggleSelect: s.toggleSelect,
      selectAll: s.selectAll,
      clearSelection: s.clearSelection,
      markDeleted: s.markDeleted,
      addInsertRow: s.addInsertRow,
      setInsertCell: s.setInsertCell,
      removeInsertRow: s.removeInsertRow,
      applySave: s.applySave,
      runQuery: s.runQuery,
      lastQueryById: s.lastQueryById,
    })),
  );
  const { activeConnectionId } = useConnectionStore();
  const { tabs, activeTabId } = useEditorStore();
  const cancelQuery = useQueryStore((s) => s.cancelQuery);
  const [editing, setEditing] = useState<{ key: string; col: string } | null>(
    null,
  );
  const [editDraft, setEditDraft] = useState("");
  const [editStart, setEditStart] = useState("");
  const [saving, setSaving] = useState(false);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const hScrollRef = useRef<HTMLDivElement | null>(null);
  const vScrollRef = useRef<HTMLDivElement | null>(null);
  const syncRef = useRef<null | "main" | "h" | "v">(null);
  const cancelingRef = useRef(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const connectionId = activeConnectionId ?? "";
  const result = connectionId ? resultById[connectionId] ?? null : null;
  const error = connectionId ? errorById[connectionId] ?? null : null;
  const running = connectionId ? runningById[connectionId] ?? false : false;
  const dirty = connectionId
    ? dirtyById[connectionId] ?? { inserts: [], updatesByKey: {}, deletesByKey: {}, selectedKeys: {} }
    : { inserts: [], updatesByKey: {}, deletesByKey: {}, selectedKeys: {} };
  const lastQuery = connectionId ? lastQueryById[connectionId] ?? "" : "";

  const cols = result?.columns ?? [];
  const editable =
    result?.editable?.enabled &&
    !!result.editable.table &&
    (result.editable.primary_key_columns?.length ?? 0) > 0;
  const pkCols = result?.editable?.primary_key_columns ?? [];

  const colIndexByName = useMemo(
    () =>
      Object.fromEntries(cols.map((c, i) => [c.name, i])) as Record<
        string,
        number
      >,
    [cols],
  );

  const canKey = useMemo(
    () => pkCols.every((c) => colIndexByName[c] != null),
    [pkCols, colIndexByName],
  );

  const rowKeys: RowKey[] = useMemo(() => {
    if (!result || !editable || !canKey) return [];
    return result.rows.map((r) =>
      pkCols.map((c) => r[colIndexByName[c]] ?? null),
    );
  }, [result, editable, canKey, pkCols, colIndexByName]);

  const hasDirty =
    dirty.inserts.length > 0 ||
    Object.keys(dirty.updatesByKey).length > 0 ||
    Object.keys(dirty.deletesByKey).length > 0;
  const hasPendingEdit = editing != null && editDraft !== editStart;

  const pagination = result?.pagination;
  const limit = pagination?.limit;
  const offset = pagination?.offset;
  const pageSize = limit ?? pagination?.page_size;
  const currentPage =
    pageSize != null && offset != null
      ? Math.floor(offset / pageSize) + 1
      : null;
  const totalRecords =
    typeof result?.total_records === "number" ? result.total_records : null;
  const isLastPageByTotal =
    pageSize != null && offset != null && totalRecords != null
      ? offset + pageSize >= totalRecords
      : false;

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

  useEffect(() => {
    const main = scrollerRef.current;
    const h = hScrollRef.current;
    const v = vScrollRef.current;
    if (!main || !h || !v) return;
    const mainEl = main;
    const hEl = h;
    const vEl = v;

    function onMain() {
      if (syncRef.current === "h" || syncRef.current === "v") return;
      syncRef.current = "main";
      hEl.scrollLeft = mainEl.scrollLeft;
      vEl.scrollTop = mainEl.scrollTop;
      syncRef.current = null;
    }

    function onH() {
      if (syncRef.current === "main" || syncRef.current === "v") return;
      syncRef.current = "h";
      mainEl.scrollLeft = hEl.scrollLeft;
      syncRef.current = null;
    }

    function onV() {
      if (syncRef.current === "main" || syncRef.current === "h") return;
      syncRef.current = "v";
      mainEl.scrollTop = vEl.scrollTop;
      syncRef.current = null;
    }

    mainEl.addEventListener("scroll", onMain, { passive: true });
    hEl.addEventListener("scroll", onH, { passive: true });
    vEl.addEventListener("scroll", onV, { passive: true });
    onMain();

    return () => {
      mainEl.removeEventListener("scroll", onMain);
      hEl.removeEventListener("scroll", onH);
      vEl.removeEventListener("scroll", onV);
    };
  }, [totalWidth, totalHeight]);

  return (
    <>
      <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[color:var(--result-bg)]">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
          <div className="flex items-center gap-3">
            <div className="text-xs text-zinc-400">Results</div>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
              Rows returned: {result?.row_count ?? 0}
            </span>
            <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
              Total records: {result?.total_records ?? "—"}
            </span>
          </div>
        </div>

        {error ? (
          <div className="m-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
            <AlertTriangle className="mt-0.5 size-4" />
            <div className="min-w-0">
              <div className="font-medium">Query failed</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-xs text-red-100/90">
                {error}
              </div>
            </div>
          </div>
        ) : null}

        {running && !error ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[color:var(--result-bg)]/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <svg className="size-5 animate-spin text-sky-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm font-medium text-zinc-300">
                  Running query...
                </span>
              </div>
              <button
                onClick={() => {
                  if (!activeConnectionId) return;
                  cancelQuery(activeConnectionId);
                }}
                className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 px-5 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/25 hover:border-red-500/60 active:scale-95"
              >
                <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h2v12H6zm5 0h2v12h-2zm5 0h2v12h-2z" />
                </svg>
                Cancel Query
              </button>
            </div>
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div
                ref={scrollerRef}
                className="hide-scrollbar min-h-0 flex-1 overflow-scroll"
              >
                <div
                  style={{
                    width: totalWidth,
                    minHeight: headerHeight + totalHeight,
                  }}
                >
                  <div
                    className="sticky top-0 z-10 border-b border-white/10 bg-[#0f0f14]"
                    style={{ height: headerHeight }}
                  >
                    <div
                      style={{
                        position: "relative",
                        width: totalWidth,
                        height: headerHeight,
                      }}
                    >
                      {colVirtualizer.getVirtualItems().map((vCol) => {
                        const col = gridColumns[vCol.index];
                        if (!col) return null;
                        if (col.kind === "select") {
                          return (
                            <div
                              key={col.key}
                              style={{
                                position: "absolute",
                                top: 0,
                                left: vCol.start,
                                width: vCol.size,
                                height: headerHeight,
                                display: "flex",
                                alignItems: "center",
                              }}
                              className="px-3"
                            >
                              {editable && canKey ? (
                                <input
                                  type="checkbox"
                                  onChange={(e) => {
                                    if (!connectionId) return;
                                    if (e.currentTarget.checked) selectAll(connectionId, rowKeys);
                                    else clearSelection(connectionId);
                                  }}
                                />
                              ) : null}
                            </div>
                          );
                        }
                        return (
                          <div
                            key={col.key}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: vCol.start,
                              width: vCol.size,
                              height: headerHeight,
                              display: "flex",
                              alignItems: "center",
                            }}
                            className="px-3"
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="truncate text-xs font-semibold text-zinc-200">
                                {col.name}
                              </span>
                              <span className="shrink-0 rounded bg-white/6 px-1.5 py-0.5 text-[10px] font-normal text-zinc-400">
                                {col.dataType}
                              </span>
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
                      const row =
                        !isInsert && result ? result.rows[dataIdx] : null;

                      const key = !isInsert ? rowKeys[dataIdx] : null;
                      const keyStr = key ? JSON.stringify(key) : null;
                      const isDeleted = keyStr
                        ? !!dirty.deletesByKey[keyStr]
                        : false;
                      const isSelected = keyStr
                        ? !!dirty.selectedKeys[keyStr]
                        : false;

                      const zebra = isInsert
                        ? "bg-emerald-500/6"
                        : dataIdx % 2 === 0
                          ? "bg-white/0"
                          : "bg-white/2";

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
                          className={clsx(
                            "border-b border-white/10",
                            zebra,
                            isDeleted && "opacity-55",
                          )}
                        >
                          <div
                            style={{
                              position: "relative",
                              width: totalWidth,
                              height: 36,
                            }}
                          >
                            {colVirtualizer.getVirtualItems().map((vCol) => {
                              const col = gridColumns[vCol.index];
                              if (!col) return null;

                              if (col.kind === "select") {
                                return (
                                  <div
                                    key={`${vRow.key}-${col.key}`}
                                    style={{
                                      position: "absolute",
                                      top: 0,
                                      left: vCol.start,
                                      width: vCol.size,
                                      height: 36,
                                      display: "flex",
                                      alignItems: "center",
                                    }}
                                    className="px-3"
                                  >
                                    {isInsert ? (
                                      <button
                                        className="text-xs text-zinc-400 hover:text-zinc-200"
                                        onClick={() => {
                                          const ins = dirty.inserts[vRow.index];
                                          if (!connectionId) return;
                                          if (ins) removeInsertRow(connectionId, ins.id);
                                        }}
                                        title="Remove new row"
                                      >
                                        ×
                                      </button>
                                    ) : editable && canKey && key ? (
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => {
                                          if (!connectionId) return;
                                          toggleSelect(connectionId, key);
                                        }}
                                      />
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
                                    style={{
                                      position: "absolute",
                                      top: 0,
                                      left: vCol.start,
                                      width: vCol.size,
                                      height: 36,
                                      display: "flex",
                                      alignItems: "center",
                                    }}
                                    className="px-3"
                                  >
                                    <Input
                                      className="h-8"
                                      value={value == null ? "" : String(value)}
                                      placeholder="NULL"
                                      onChange={(e) => {
                                        if (!ins) return;
                                        if (!connectionId) return;
                                        setInsertCell(connectionId, ins.id, col.name, parseInput(e.currentTarget.value));
                                      }}
                                    />
                                  </div>
                                );
                              }

                              const isPk = pkCols.includes(col.name);
                              const canEditCell =
                                editable &&
                                canKey &&
                                key &&
                                !isDeleted &&
                                !isPk;
                              const cellKey = keyStr
                                ? { key: keyStr, col: col.name }
                                : null;
                              const isEditing =
                                !!cellKey &&
                                editing?.key === cellKey.key &&
                                editing?.col === cellKey.col;
                              const dirtyRow = keyStr
                                ? dirty.updatesByKey[keyStr]
                                : undefined;
                              const hasDirtyCol =
                                !!dirtyRow &&
                                Object.prototype.hasOwnProperty.call(
                                  dirtyRow,
                                  col.name,
                                );
                              const rawValue =
                                (hasDirtyCol
                                  ? dirtyRow?.[col.name]
                                  : row?.[col.colIndex]) ?? null;
                              const display = toDisplay(rawValue);
                              const initialText =
                                rawValue === null
                                  ? ""
                                  : typeof rawValue === "string"
                                    ? rawValue
                                    : typeof rawValue === "number" ||
                                        typeof rawValue === "boolean"
                                      ? String(rawValue)
                                      : JSON.stringify(rawValue);

                              return (
                                <div
                                  key={`${vRow.key}-${col.key}`}
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    left: vCol.start,
                                    width: vCol.size,
                                    height: 36,
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                  className={clsx(
                                    "px-3",
                                    isPk && "text-zinc-300",
                                    canEditCell && "cursor-text",
                                  )}
                                  onDoubleClick={() => {
                                    if (!canEditCell || !cellKey) return;
                                    setEditing(cellKey);
                                    setEditDraft(initialText);
                                    setEditStart(initialText);
                                  }}
                                >
                                  {isEditing && canEditCell && key ? (
                                    <Input
                                      autoFocus
                                      className="h-8"
                                      value={editDraft}
                                      onChange={(e) =>
                                        setEditDraft(e.currentTarget.value)
                                      }
                                      onBlur={(e) => {
                                        if (cancelingRef.current) {
                                          cancelingRef.current = false;
                                          setEditing(null);
                                          return;
                                        }
                                        const nextText = e.currentTarget.value;
                                        if (nextText !== editStart)
                                          setCell(
                                            connectionId,
                                            key,
                                            col.name,
                                            parseInput(nextText),
                                          );
                                        setEditing(null);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          (
                                            e.currentTarget as HTMLInputElement
                                          ).blur();
                                        if (e.key === "Escape") {
                                          setEditDraft(editStart);
                                          setEditing(null);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <div
                                      className={clsx(
                                        "w-full truncate",
                                        display === "NULL" &&
                                          "italic text-zinc-500",
                                      )}
                                      title={display}
                                    >
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

              <div
                ref={hScrollRef}
                className="result-scrollbar h-4 overflow-x-scroll overflow-y-hidden border-t border-white/10 bg-white/14"
              >
                <div style={{ width: totalWidth, height: 1 }} />
              </div>
            </div>

            <div className="flex min-h-0 w-4 flex-col border-l border-white/10 bg-white/14">
              <div
                ref={vScrollRef}
                className="result-scrollbar min-h-0 flex-1 overflow-y-scroll overflow-x-hidden"
              >
                <div style={{ height: headerHeight + totalHeight, width: 1 }} />
              </div>
              <div className="h-4 border-t border-white/10" />
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-[color:var(--result-bg)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {editable ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!connectionId) return;
                  addInsertRow(connectionId);
                }}
              >
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
                  if (keys.length === 0) return;
                  void (async () => {
                    const ok = await useDialogStore.getState().confirm({
                      title: "Delete selected",
                      message: `Mark ${keys.length} row(s) for deletion?\n\nClick Save to apply.`,
                      confirmText: "Mark delete",
                      cancelText: "Cancel",
                    });
                    if (!ok) return;
                    for (const ks of keys) {
                      if (!connectionId) return;
                      markDeleted(connectionId, JSON.parse(ks) as RowKey);
                    }
                    if (!connectionId) return;
                    clearSelection(connectionId);
                  })();
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
                onMouseDown={() => {
                  cancelingRef.current = true;
                }}
                onClick={() => {
                  if (!connectionId) return;
                  clearDirty(connectionId);
                  clearSelection(connectionId);
                  setEditing(null);
                  setEditDraft("");
                  setEditStart("");
                  queueMicrotask(() => {
                    cancelingRef.current = false;
                  });
                }}
                disabled={!hasDirty && !hasPendingEdit}
              >
                Cancel
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {pageSize != null && offset != null && currentPage != null ? (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
                  Page {currentPage}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!activeConnectionId) return;
                    const nextQuery = rewriteLimitOffset(
                      lastQuery || activeTab?.content || "",
                      { limit: pageSize, offset: 0 },
                    );
                    await runQuery({
                      connectionId: activeConnectionId,
                      query: nextQuery,
                    });
                  }}
                  disabled={!activeConnectionId || offset <= 0 || running}
                  title="First page"
                >
                  <ChevronsLeft className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!activeConnectionId) return;
                    const nextOffset = Math.max(0, offset - pageSize);
                    const nextQuery = rewriteLimitOffset(
                      lastQuery || activeTab?.content || "",
                      { limit: pageSize, offset: nextOffset },
                    );
                    await runQuery({
                      connectionId: activeConnectionId,
                      query: nextQuery,
                    });
                  }}
                  disabled={!activeConnectionId || offset <= 0 || running}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!activeConnectionId) return;
                    const nextOffset = offset + pageSize;
                    const nextQuery = rewriteLimitOffset(
                      lastQuery || activeTab?.content || "",
                      { limit: pageSize, offset: nextOffset },
                    );
                    await runQuery({
                      connectionId: activeConnectionId,
                      query: nextQuery,
                    });
                  }}
                  disabled={!activeConnectionId || running || isLastPageByTotal}
                >
                  Next
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!activeConnectionId) return;
                    if (totalRecords == null) return;
                    const safeTotal = Math.max(0, totalRecords);
                    const lastOffset =
                      safeTotal <= 0
                        ? 0
                        : Math.floor((safeTotal - 1) / pageSize) * pageSize;
                    const nextQuery = rewriteLimitOffset(
                      lastQuery || activeTab?.content || "",
                      { limit: pageSize, offset: lastOffset },
                    );
                    await runQuery({
                      connectionId: activeConnectionId,
                      query: nextQuery,
                    });
                  }}
                  disabled={
                    !activeConnectionId ||
                    running ||
                    totalRecords == null ||
                    isLastPageByTotal
                  }
                  title={
                    totalRecords == null
                      ? "Last page (needs total records)"
                      : "Last page"
                  }
                >
                  <ChevronsRight className="size-4" />
                </Button>
              </div>
            ) : null}

            <Button
              size="sm"
              onClick={async () => {
                if (!activeConnectionId) return;
                if (!editable) return;
                if (!hasDirty && !hasPendingEdit) return;
                if (editing && hasPendingEdit) {
                  setCell(connectionId, JSON.parse(editing.key) as RowKey, editing.col, parseInput(editDraft));
                  setEditing(null);
                }
                const snap = useQueryStore.getState().dirtyById[connectionId] ?? { inserts: [], updatesByKey: {}, deletesByKey: {}, selectedKeys: {} };
                const ins = snap.inserts.length;
                const upd = Object.keys(snap.updatesByKey).length;
                const del = Object.keys(snap.deletesByKey).length;
                const ok = await useDialogStore.getState().confirm({
                  title: "Apply changes",
                  message: `Apply changes now?\n\nInserts: ${ins}\nUpdates: ${upd}\nDeletes: ${del}`,
                  confirmText: "Apply",
                  cancelText: "Cancel",
                });
                if (!ok) return;
                setSaving(true);
                try {
                  await applySave({ connectionId: activeConnectionId });
                  const q = lastQuery || activeTab?.content || "";
                  await runQuery({
                    connectionId: activeConnectionId,
                    query: q,
                  });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  await useDialogStore.getState().alert({ title: "Save failed", message: msg });
                } finally {
                  setSaving(false);
                }
              }}
              disabled={
                !activeConnectionId ||
                !editable ||
                (!hasDirty && !hasPendingEdit) ||
                saving
              }
            >
              <Save className="size-4" />
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        </div>

        {!editable && result?.editable?.reason_disabled ? (
          <div className="mt-2 text-xs text-zinc-500">
            Read-only: {result.editable.reason_disabled}
          </div>
        ) : null}
      </div>
    </>
  );
}
