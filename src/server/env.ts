/** Minimal D1 surface we use; matches Cloudflare's D1Database so tests can swap in SQLite. */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { last_row_id?: number; changes?: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface Env {
  DB: D1Database;
  /** HMAC key for member session cookies. Pages secret. */
  SESSION_SECRET: string;
  /** Cloudflare Access team domain, e.g. "qrpc.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access application audience tag. */
  ACCESS_AUD?: string;
  /** Local development only: treat requests as this admin when Access is not configured. */
  DEV_ADMIN_EMAIL?: string;
}

export const CLUB_ID = 1;
