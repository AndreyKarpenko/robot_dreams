export type SqlQuery = (sql: string, params?: any[]) => Promise<unknown>;

function isRow(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** TypeORM returns a row array; node-pg returns `{ rows }`. */
export function rowsFrom(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    if (
      raw.length === 2 &&
      Array.isArray(raw[0]) &&
      (typeof raw[1] === 'number' || raw[1] == null)
    ) {
      return raw[0] as Array<Record<string, unknown>>;
    }
    if (raw.length === 0 || isRow(raw[0])) {
      return raw as Array<Record<string, unknown>>;
    }
  }
  if (isRow(raw) && Array.isArray(raw.rows)) {
    return raw.rows as Array<Record<string, unknown>>;
  }
  return [];
}

/** Postgres unique_violation. TypeORM wraps it; node-pg sets `code` itself. */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const record = err as { code?: unknown; driverError?: { code?: unknown } };
  return record.code === '23505' || record.driverError?.code === '23505';
}
