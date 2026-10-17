/**
 * A `D1Like` backed by `node:sqlite`, so the adapter's SQL — the conditional
 * UPDATE that carries the CAS, the prefix range scan, the TTL filter — runs
 * against a real SQLite engine in tests instead of a hand-written fake.
 *
 * D1 and this share an engine but not an API shape; only the handful of
 * methods `D1Repo` uses are mapped.
 */

import { DatabaseSync } from "node:sqlite";

import { D1_KV_SCHEMA, type D1Like, type D1PreparedLike } from "./d1.ts";

export const createSqliteD1 = (): D1Like & { close(): void } => {
  const db = new DatabaseSync(":memory:");
  db.exec(D1_KV_SCHEMA);

  // D1 uses ?1-style parameters; node:sqlite binds those positionally too.
  const prepare = (sql: string): D1PreparedLike => {
    let args: unknown[] = [];
    const self: D1PreparedLike = {
      bind(...values: unknown[]) {
        args = values;
        return self;
      },
      first<T>() {
        const row = db.prepare(sql).get(...args as never[]);
        return Promise.resolve((row ?? null) as T | null);
      },
      all<T>() {
        const rows = db.prepare(sql).all(...args as never[]);
        return Promise.resolve({ results: rows as T[] });
      },
      run() {
        const res = db.prepare(sql).run(...args as never[]);
        return Promise.resolve({ meta: { changes: Number(res.changes) } });
      },
    };
    return self;
  };

  return { prepare, close: () => db.close() };
};
