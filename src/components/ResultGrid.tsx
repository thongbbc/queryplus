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
import DatePicker from "react-datepicker";
import { useQueryStore } from "../stores/queryStore";
import type { JsonValue, RowKey } from "../types/query";
import { useConnectionStore } from "../stores/connectionStore";
import { rewriteLimitOffset } from "../utils/sql";
import { useEditorStore } from "../stores/editorStore";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { useDialogStore } from "../stores/dialogStore";

let measureCanvas: HTMLCanvasElement | null = null;
function measureTextPx(text: string, font: string): number {
  if (!text) return 0;
  if (typeof document === "undefined") return text.length * 8;
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * 8;
  ctx.font = font;
  return ctx.measureText(text).width;
}

const headerNameFont =
  '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial';
const headerTypeFont =
  '400 10px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial';
const cellFont =
  '400 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial';

function estimateColumnWidthFromSamples(
  name: string,
  dataType: string,
  samples: string[],
): number {
  const cellPad = 28;
  const headerPad = 24 + 24;
  const headerMin = Math.max(
    measureTextPx(name, headerNameFont),
    measureTextPx(dataType, headerTypeFont),
  ) + headerPad;
  let maxPx = headerMin;
  for (const s of samples) {
    maxPx = Math.max(maxPx, measureTextPx(s, cellFont) + cellPad);
  }
  return Math.max(120, Math.min(720, Math.ceil(maxPx)));
}

function toDisplay(v: JsonValue): string {
  if (v === null) return "NULL";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `Array(${v.length})`;
  // JSON object: show as truncated JSON string
  const json = JSON.stringify(v);
  return json.length > 500 ? json.slice(0, 500) + "…" : json;
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

type EditKind = "text" | "number" | "boolean" | "date" | "time" | "datetime" | "enum";

function inferEditKind(dataType: string, enumValues?: string[]): EditKind {
  if (enumValues && enumValues.length > 0) return "enum";
  const t = dataType.toLowerCase();
  if (t.includes("bool")) return "boolean";
  if (t === "date") return "date";
  if (t === "time" || t.includes("time without time zone")) return "time";
  if (t.includes("timestamp") || t.includes("datetime")) return "datetime";
  if (
    t.includes("int") ||
    t.includes("serial") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t === "real"
  )
    return "number";
  return "text";
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateFromDateString(s: string): Date | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo, d);
}

function toDateFromDateTimeString(s: string): Date | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(
      normalized,
    );
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6] ?? "0");
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hh) ||
    !Number.isFinite(mm) ||
    !Number.isFinite(ss)
  )
    return null;
  return new Date(y, mo, d, hh, mm, ss);
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toDateTimeInputString(d: Date): string {
  return `${toDateString(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function currentDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function currentTimeString(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function currentDateTimeString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function toInputDateTimeValue(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  if (normalized.length >= 19) return normalized.slice(0, 19);
  if (normalized.length >= 16) return normalized.slice(0, 16);
  return normalized;
}

type GridColumn =
  | { key: "__select__"; kind: "select"; width: number }
  | {
      key: string;
      kind: "data";
      name: string;
      dataType: string;
      enumValues?: string[];
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
  const [cellMenu, setCellMenu] = useState<null | { x: number; y: number; kind: EditKind; key: RowKey; col: string }>(null);
  const [valueMenu, setValueMenu] = useState<null | { x: number; y: number; kind: "enum" | "boolean"; key: RowKey; col: string; options: string[] }>(null);
  const [dateMenu, setDateMenu] = useState<null | { x: number; y: number; kind: "date" | "datetime"; key: RowKey; col: string }>(null);
  const [colWidthByName, setColWidthByName] = useState<Record<string, number>>({});

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const hScrollRef = useRef<HTMLDivElement | null>(null);
  const vScrollRef = useRef<HTMLDivElement | null>(null);
  const syncRef = useRef<null | "main" | "h" | "v">(null);
  const cancelingRef = useRef(false);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const resizingRef = useRef<null | { name: string; startX: number; startWidth: number }>(null);

  useEffect(() => {
    if (!cellMenu) return;
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-cell-menu="1"]')) return;
      setCellMenu(null);
      setEditing(null);
    }
    function onScroll() {
      setCellMenu(null);
      setEditing(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCellMenu(null);
        setEditing(null);
      }
    }
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [cellMenu]);

  useEffect(() => {
    if (!valueMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setValueMenu(null);
        setEditing(null);
      }
    }
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-value-menu="1"]')) return;
      setValueMenu(null);
      setEditing(null);
    }
    function onScroll(e: Event) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-value-menu="1"]')) return;
      setValueMenu(null);
      setEditing(null);
    }

    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [valueMenu]);

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
  const editingKind = useMemo(() => {
    if (!editing) return null;
    const col = cols.find((c) => c.name === editing.col);
    if (!col) return null;
    return inferEditKind(col.data_type, col.enum_values);
  }, [editing, cols]);

  useEffect(() => {
    if (!editing) setDateMenu(null);
  }, [editing]);

  useEffect(() => {
    if (!dateMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setEditing(null);
        setDateMenu(null);
        setValueMenu(null);
        setCellMenu(null);
      }
    }
    function onScroll(e: Event) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-date-menu="1"]')) return;
      setEditing(null);
      setDateMenu(null);
    }

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [dateMenu]);

  useEffect(() => {
    if (!editing) return;
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-value-menu="1"]')) return;
      if (target?.closest?.('[data-cell-menu="1"]')) return;
      if (target?.closest?.('[data-edit-wrapper="1"]')) return;
      if (target?.closest?.('[data-edit-button="1"]')) return;
      if (target?.closest?.('[data-date-menu="1"]')) return;
      setValueMenu(null);
      setCellMenu(null);
      if (editingKind === "date" || editingKind === "datetime") {
        setEditing(null);
        setDateMenu(null);
        return;
      }
      if (editInputRef.current) editInputRef.current.blur();
      else setEditing(null);
    }
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [editing, editingKind, editStart]);

  useEffect(() => {
    if (!editing) return;
    if (editingKind === "date" || editingKind === "time" || editingKind === "datetime") {
      const el = editInputRef.current;
      if (!el) return;
      requestAnimationFrame(() => el.focus());
    }
  }, [editing, editingKind]);

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
    const sampleRows = (result?.rows ?? []).slice(0, 80);
    const dataCols: GridColumn[] = cols.map((c, idx) => ({
      key: c.name,
      kind: "data",
      name: c.name,
      dataType: c.data_type,
      enumValues: c.enum_values,
      width:
        colWidthByName[c.name] ??
        estimateColumnWidthFromSamples(
          c.name,
          c.data_type,
          sampleRows.map((r) => toDisplay((r?.[idx] as JsonValue | undefined) ?? null)),
        ),
      colIndex: idx,
    }));
    return [{ key: "__select__", kind: "select", width: 44 }, ...dataCols];
  }, [cols, colWidthByName, result?.rows]);

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
  const headerHeight = 44;

  useEffect(() => {
    colVirtualizer.measure();
  }, [colVirtualizer, colWidthByName]);

  function startResize(
    e: React.MouseEvent,
    name: string,
    startWidth: number,
  ) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { name, startX: e.clientX, startWidth };

    function onMove(ev: MouseEvent) {
      const cur = resizingRef.current;
      if (!cur) return;
      const next = Math.max(80, Math.min(1000, cur.startWidth + (ev.clientX - cur.startX)));
      setColWidthByName((prev) => (prev[cur.name] === next ? prev : { ...prev, [cur.name]: next }));
    }

    function onUp() {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mouseup", onUp, true);
    }

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
  }

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
            {/* <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1">
              Total records: {result?.total_records ?? "—"}
            </span> */}
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

        {cellMenu ? (
          <div
            className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-white/10 bg-[#0f0f14] shadow-2xl"
            data-cell-menu="1"
            style={{ left: cellMenu.x, top: cellMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/5"
              onClick={() => {
                if (!connectionId) return;
                setCell(connectionId, cellMenu.key, cellMenu.col, null);
                setEditing(null);
                setCellMenu(null);
              }}
            >
              Set NULL
            </button>
            <button
              className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/5"
              onClick={() => {
                const text = editDraft || editStart;
                if (text) navigator.clipboard.writeText(text).catch(() => {});
                setCellMenu(null);
              }}
            >
              Copy <span className="text-zinc-500">Ctrl+C</span>
            </button>
            <button
              className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/5"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (text == null) return;
                  if (!connectionId) return;
                  setCell(connectionId, cellMenu.key, cellMenu.col, parseInput(text));
                  setEditDraft(text);
                  setEditing(null);
                  setCellMenu(null);
                } catch {
                  // Clipboard read denied
                }
              }}
            >
              Paste <span className="text-zinc-500">Ctrl+V</span>
            </button>
            {cellMenu.kind === "time" ? (
              <button
                className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/5"
                onClick={() => {
                  if (!connectionId) return;
                  setCell(connectionId, cellMenu.key, cellMenu.col, currentTimeString());
                  setEditing(null);
                  setCellMenu(null);
                }}
              >
                Set current time
              </button>
            ) : null}
            {cellMenu.kind === "date" ? (
              <button
                className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/5"
                onClick={() => {
                  if (!connectionId) return;
                  setCell(connectionId, cellMenu.key, cellMenu.col, currentDateString());
                  setEditing(null);
                  setCellMenu(null);
                }}
              >
                Set current date
              </button>
            ) : null}
            {cellMenu.kind === "datetime" ? (
              <button
                className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/5"
                onClick={() => {
                  if (!connectionId) return;
                  setCell(connectionId, cellMenu.key, cellMenu.col, currentDateTimeString());
                  setEditing(null);
                  setCellMenu(null);
                }}
              >
                Set current datetime
              </button>
            ) : null}
          </div>
        ) : null}

        {valueMenu ? (
          <div
            className="fixed z-50 w-[240px] overflow-hidden rounded-lg border border-white/10 bg-[#0f0f14] shadow-2xl"
            data-value-menu="1"
            style={{ left: valueMenu.x, top: valueMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setValueMenu(null);
              setCellMenu({
                x: e.clientX,
                y: e.clientY,
                kind: valueMenu.kind,
                key: valueMenu.key,
                col: valueMenu.col,
              });
            }}
          >
            <div className="result-scrollbar max-h-56 overflow-y-auto">
              <button
                className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/5"
                onClick={() => {
                  if (!connectionId) return;
                  setCell(connectionId, valueMenu.key, valueMenu.col, null);
                  setEditing(null);
                  setValueMenu(null);
                }}
              >
                NULL
              </button>
              {valueMenu.options.map((opt) => (
                <button
                  key={opt}
                  className="w-full px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/5"
                  onClick={() => {
                    if (!connectionId) return;
                    if (valueMenu.kind === "boolean") {
                      if (opt === "true") setCell(connectionId, valueMenu.key, valueMenu.col, true);
                      else if (opt === "false") setCell(connectionId, valueMenu.key, valueMenu.col, false);
                      else setCell(connectionId, valueMenu.key, valueMenu.col, null);
                    } else {
                      setCell(connectionId, valueMenu.key, valueMenu.col, opt);
                    }
                    setEditing(null);
                    setValueMenu(null);
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {dateMenu ? (
          <div
            className="fixed z-50"
            data-date-menu="1"
            style={{ left: dateMenu.x, top: dateMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <DatePicker
              inline
              selected={
                dateMenu.kind === "datetime"
                  ? toDateFromDateTimeString(editDraft)
                  : toDateFromDateString(editDraft)
              }
              showTimeSelect={dateMenu.kind === "datetime"}
              timeIntervals={1}
              timeFormat="HH:mm"
              dateFormat={dateMenu.kind === "datetime" ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd"}
              onChange={(d: Date | [Date | null, Date | null] | null) => {
                if (!connectionId) return;
                const v = Array.isArray(d) ? d[0] : d;
                if (!(v instanceof Date) || Number.isNaN(v.getTime())) return;
                if (dateMenu.kind === "date") {
                  const out = toDateString(v);
                  setEditDraft(out);
                  setCell(connectionId, dateMenu.key, dateMenu.col, out);
                  setEditing(null);
                  setDateMenu(null);
                  setValueMenu(null);
                  setCellMenu(null);
                } else {
                  const outInput = toDateTimeInputString(v);
                  setEditDraft(outInput);
                  setCell(connectionId, dateMenu.key, dateMenu.col, outInput.replace("T", " "));
                }
              }}
            />
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
                              className={clsx(
                                "h-full border-r border-white/10 px-3",
                                vCol.index === 0 && "border-l border-white/10",
                              )}
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
                            className={clsx(
                              "relative h-full border-r border-white/10 px-3",
                              vCol.index === 0 && "border-l border-white/10",
                            )}
                          >
                            <div className="flex w-full min-w-0 flex-col justify-center gap-0.5 pr-10 leading-tight">
                              <div className="truncate whitespace-nowrap text-xs font-semibold text-zinc-200">
                                {col.name}
                              </div>
                              <div className="truncate whitespace-nowrap text-[10px] font-normal text-zinc-400">
                                {col.dataType}
                              </div>
                            </div>
                            <div
                              className="absolute right-0 top-0 h-full w-3 cursor-col-resize select-none hover:bg-white/5"
                              onMouseDown={(e) => startResize(e, col.name, gridColumns[vCol.index]?.width ?? vCol.size)}
                            >
                              <div className="absolute right-1 top-0 h-full w-px bg-white/10" />
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
                            isSelected && "bg-sky-500/12 ring-1 ring-inset ring-sky-400/40",
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
                                    className={clsx(
                                      "h-full border-r border-white/10 px-3",
                                      vCol.index === 0 && "border-l border-white/10",
                                    )}
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
                                    className={clsx(
                                      "h-full border-r border-white/10 px-3",
                                      vCol.index === 0 && "border-l border-white/10",
                                    )}
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
                              const isDirtyCell = hasDirtyCol && !isDeleted;
                              const rawValue =
                                (hasDirtyCol
                                  ? dirtyRow?.[col.name]
                                  : row?.[col.colIndex]) ?? null;
                              const display = toDisplay(rawValue);
                              const kind = inferEditKind(col.dataType, col.enumValues);
                              const baseText =
                                rawValue === null
                                  ? ""
                                  : typeof rawValue === "string"
                                    ? rawValue
                                    : typeof rawValue === "number" || typeof rawValue === "boolean"
                                      ? String(rawValue)
                                      : JSON.stringify(rawValue);
                              const initialText =
                                kind === "datetime"
                                  ? toInputDateTimeValue(baseText)
                                  : kind === "date"
                                    ? baseText.trim().slice(0, 10)
                                    : baseText;

                              return (
                                <div
                                  key={`${vRow.key}-${col.key}`}
                                  data-cell-key={keyStr}
                                  data-cell-col={col.name}
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
                                    "h-full border-r border-white/10 px-3",
                                    vCol.index === 0 && "border-l border-white/10",
                                    isPk && "text-zinc-300",
                                    canEditCell && "cursor-text",
                                    isDirtyCell && "rounded-md bg-sky-500/12 ring-1 ring-sky-400/40",
                                  )}
                                  onClick={(e) => {
                                    if (!canEditCell || !cellKey || !key) return;
                                    if (cellMenu) setCellMenu(null);
                                    if (kind === "enum" || kind === "boolean") {
                                      const sameMenu =
                                        !!valueMenu &&
                                        valueMenu.col === col.name &&
                                        JSON.stringify(valueMenu.key) === keyStr;
                                      if (sameMenu) return;
                                      const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                      setEditing(cellKey);
                                      setEditDraft(initialText);
                                      setEditStart(initialText);
                                      setValueMenu(null);
                                      setValueMenu({
                                        x: Math.max(8, Math.min(window.innerWidth - 260, Math.round(r.left))),
                                        y: Math.max(8, Math.min(window.innerHeight - 260, Math.round(r.bottom + 6))),
                                        kind,
                                        key,
                                        col: col.name,
                                        options: kind === "boolean" ? ["true", "false"] : (col.enumValues ?? []),
                                      });
                                      return;
                                    }
                                    if (valueMenu) setValueMenu(null);
                                    if (kind === "date" || kind === "datetime") {
                                      const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                      setEditing(cellKey);
                                      setEditDraft(initialText);
                                      setEditStart(initialText);
                                      setDateMenu({
                                        x: Math.max(8, Math.min(window.innerWidth - 360, Math.round(r.left))),
                                        y: Math.max(8, Math.min(window.innerHeight - (kind === "datetime" ? 520 : 420), Math.round(r.bottom + 6))),
                                        kind,
                                        key,
                                        col: col.name,
                                      });
                                      return;
                                    }
                                    if (kind === "time") {
                                      setDateMenu(null);
                                      setEditing(cellKey);
                                      setEditDraft(initialText);
                                      setEditStart(initialText);
                                      return;
                                    }
                                  }}
                                  onDoubleClick={(e) => {
                                    if (!canEditCell || !cellKey) return;
                                    if (kind === "date" || kind === "datetime") {
                                      const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                      setDateMenu({
                                        x: Math.max(8, Math.min(window.innerWidth - 360, Math.round(r.left))),
                                        y: Math.max(8, Math.min(window.innerHeight - (kind === "datetime" ? 520 : 420), Math.round(r.bottom + 6))),
                                        kind,
                                        key,
                                        col: col.name,
                                      });
                                    } else {
                                      setDateMenu(null);
                                    }
                                    setEditing(cellKey);
                                    setEditDraft(initialText);
                                    setEditStart(initialText);
                                  }}
                                  onContextMenu={(e) => {
                                    if (!canEditCell || !cellKey || !key) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (
                                      cellMenu &&
                                      cellMenu.col === col.name &&
                                      JSON.stringify(cellMenu.key) === keyStr
                                    )
                                      return;
                                    if (valueMenu) setValueMenu(null);
                                    setEditing(cellKey);
                                    setEditDraft(initialText);
                                    setEditStart(initialText);
                                    setCellMenu({ x: e.clientX, y: e.clientY, kind, key, col: col.name });
                                  }}
                                >
                                  {isEditing && canEditCell && key ? (
                                    kind === "enum" || kind === "boolean" ? (
                                      <button
                                        className="flex h-8 w-full items-center justify-between rounded-md border border-zinc-300/70 bg-white px-2 text-sm text-black focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                        data-edit-button="1"
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          if (cellMenu) setCellMenu(null);
                                          const sameMenu =
                                            !!valueMenu &&
                                            valueMenu.col === col.name &&
                                            JSON.stringify(valueMenu.key) === keyStr;
                                          if (sameMenu) return;
                                          const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                          setValueMenu(null);
                                          setValueMenu({
                                            x: Math.max(8, Math.min(window.innerWidth - 260, Math.round(r.left))),
                                            y: Math.max(8, Math.min(window.innerHeight - 260, Math.round(r.bottom + 6))),
                                            kind,
                                            key,
                                            col: col.name,
                                            options: kind === "boolean" ? ["true", "false"] : (col.enumValues ?? []),
                                          });
                                        }}
                                      >
                                        <span className={clsx("min-w-0 flex-1 truncate text-left", !editDraft && "text-zinc-500")}>
                                          {editDraft || "Select…"}
                                        </span>
                                        <span className="ml-2 text-zinc-400">▾</span>
                                      </button>
                                    ) : kind === "date" || kind === "datetime" ? (
                                      <div className="flex h-8 w-full items-center" data-edit-wrapper="1">
                                        <Input
                                          autoFocus
                                          ref={editInputRef}
                                          data-edit-input="1"
                                          className="h-8 w-full px-2"
                                          type="text"
                                          readOnly
                                          value={kind === "datetime" ? editDraft.replace("T", " ") : editDraft}
                                          onKeyDown={(e) => {
                                            if (e.key === "Escape") {
                                              setEditing(null);
                                              setDateMenu(null);
                                            }
                                          }}
                                        />
                                      </div>
                                    ) : kind === "time" ? (
                                      <Input
                                        autoFocus
                                        ref={editInputRef}
                                        data-edit-input="1"
                                        data-edit-wrapper="1"
                                        className="h-8 px-2"
                                        type="time"
                                        step={1}
                                        value={editDraft}
                                        onChange={(e) => setEditDraft(e.currentTarget.value)}
                                        onBlur={(e) => {
                                          const nextText = e.currentTarget.value;
                                          if (connectionId && key && nextText !== editStart) {
                                            const trimmed = nextText.trim();
                                            setCell(connectionId, key, col.name, trimmed ? trimmed : null);
                                          }
                                          setEditing(null);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                                          if (e.key === "Escape") {
                                            setEditDraft(editStart);
                                            setEditing(null);
                                          }
                                        }}
                                      />
                                    ) : (
                                      <Input
                                        autoFocus
                                        ref={editInputRef}
                                        data-edit-input="1"
                                        data-edit-wrapper="1"
                                        className="h-8"
                                        type={kind === "number" ? "number" : "text"}
                                        inputMode={kind === "number" ? "decimal" : undefined}
                                        value={editDraft}
                                        onChange={(e) => {
                                          setEditDraft(e.currentTarget.value);
                                        }}
                                        onBlur={(e) => {
                                          if (cancelingRef.current) {
                                            cancelingRef.current = false;
                                            setEditing(null);
                                            return;
                                          }
                                          const nextText = e.currentTarget.value;
                                          if (nextText !== editStart) {
                                            if (kind === "number") {
                                              const trimmed = nextText.trim();
                                              if (!trimmed) setCell(connectionId, key, col.name, null);
                                              else {
                                                const n = Number(trimmed);
                                                setCell(connectionId, key, col.name, Number.isFinite(n) ? n : trimmed);
                                              }
                                            } else {
                                              setCell(connectionId, key, col.name, parseInput(nextText));
                                            }
                                          }
                                          setEditing(null);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                                          if (e.key === "Escape") {
                                            setEditDraft(editStart);
                                            setEditing(null);
                                          }
                                        }}
                                      />
                                    )
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
