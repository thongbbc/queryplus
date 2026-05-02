export function extractLimitOffset(sql: string): { limit?: number; offset?: number } {
  const m = sql.match(/\blimit\s+(\d+)(?:\s+offset\s+(\d+))?/i);
  if (!m) return {};
  const limit = Number(m[1]);
  const offset = m[2] ? Number(m[2]) : 0;
  return {
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  };
}

export function ensureLimitOffset(sql: string, fallback: { limit: number; offset: number }): string {
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed)) return sql;
  const hasLimit = /\blimit\s+\d+/i.test(trimmed);
  if (hasLimit) return sql;
  const noSemi = trimmed.replace(/;\s*$/, "");
  return `${noSemi} LIMIT ${fallback.limit} OFFSET ${fallback.offset}`;
}

export function rewriteLimitOffset(sql: string, next: { limit: number; offset: number }): string {
  const hasLimit = /\blimit\s+\d+/i.test(sql);
  if (!hasLimit) return ensureLimitOffset(sql, next);
  const re = /\blimit\s+\d+(?:\s+offset\s+\d+)?/gi;
  let lastIndex = -1;
  let lastLen = 0;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(sql)) !== null) {
    lastIndex = m.index;
    lastLen = m[0].length;
  }
  if (lastIndex < 0) return ensureLimitOffset(sql, next);
  return `${sql.slice(0, lastIndex)}LIMIT ${next.limit} OFFSET ${next.offset}${sql.slice(lastIndex + lastLen)}`;
}

export function extractSelectedOrStatement(sqlText: string, sel: { from: number; to: number } | null): string {
  const raw = sel && sel.from !== sel.to ? sqlText.slice(sel.from, sel.to) : extractStatementAt(sqlText, sel?.from ?? 0);
  const cleaned = raw.trim();
  if (!cleaned) return sqlText.trim();
  return firstStatement(cleaned);
}

function extractStatementAt(sqlText: string, cursor: number): string {
  const pos = clamp(cursor, 0, sqlText.length);
  const before = sqlText.lastIndexOf(";", pos - 1);
  const after = sqlText.indexOf(";", pos);
  const start = before === -1 ? 0 : before + 1;
  const end = after === -1 ? sqlText.length : after;
  return sqlText.slice(start, end);
}

function firstStatement(sqlText: string): string {
  const parts = sqlText
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[0] ?? "";
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
