/** D1-compatible wrapper over node:sqlite, running the real migrations. Test-only. */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "../../src/server/env";

type Bindable = null | number | bigint | string;

class Stmt implements D1PreparedStatement {
  constructor(private db: DatabaseSync, private sql: string, private params: Bindable[] = []) {}
  bind(...values: unknown[]): D1PreparedStatement {
    return new Stmt(this.db, this.sql, values.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : (v as Bindable))));
  }
  async first<T>(): Promise<T | null> {
    return ((this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null);
  }
  async all<T>(): Promise<D1Result<T>> {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], meta: {} };
  }
  async run(): Promise<D1Result> {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { results: [], meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  }
}

export function testDb(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  return {
    raw: db,
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: D1PreparedStatement[]) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
