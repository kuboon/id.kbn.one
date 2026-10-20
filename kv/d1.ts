/**
 * Cloudflare D1 implementation of {@link KvRepo}.
 *
 * Deno KV is replaced by D1 rather than Cloudflare KV because this app relies
 * on atomic compare-and-set: `update()` backs OAuth authorization codes being
 * single-use, refresh-token reuse detection, and push rate limiting. Workers
 * KV is eventually consistent with no CAS, so those would fail silently.
 * Here the CAS is a conditional `UPDATE ... WHERE version = ?`, and SQLite
 * reports whether the row actually changed.
 *
 * Keys keep Deno KV's shape (an array of parts) and are encoded into one
 * ordered TEXT primary key, so a prefix listing is a range scan on that key.
 *
 * @module
 */

import { monotonicUlid } from "@std/ulid";

import type {
  KvEntryInterface,
  KvKey,
  KvKeyPart,
  KvOptions,
  KvRepo,
  KvUpdateResult,
} from "./types.ts";

/** The subset of Cloudflare's `D1Database` this repo needs. */
export interface D1Like {
  prepare(sql: string): D1PreparedLike;
}

export interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

/**
 * DDL for the backing table. Every statement is `IF NOT EXISTS`, so applying
 * it to a database that already has the table changes nothing.
 */
export const D1_KV_SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS kv_expires_at ON kv (expires_at);
`;

/** Create the table and its index if they are missing. Idempotent. */
export const applyD1Schema = async (db: D1Like): Promise<void> => {
  // One statement per `prepare`: that is all D1's prepared statements take.
  for (const statement of D1_KV_SCHEMA.split(";")) {
    if (statement.trim()) await db.prepare(statement.trim() + ";").run();
  }
};

/**
 * A database handle that reaches the real one only when a statement runs,
 * and makes sure the schema exists before the first one does.
 *
 * Both halves come from running on Workers. The binding cannot be touched at
 * module scope — deploying runs the top-level scope to validate the Worker,
 * with no binding attached — so it is looked up per statement. And nothing
 * in a deploy creates the table: production has it only because the
 * migration from Deno KV did, so a preview, a fresh database or `cf dev`'s
 * local one would answer every request with `no such table: kv`. Ensuring it
 * here costs one idempotent statement per isolate and covers all of them.
 *
 * A failed attempt is not remembered, so the next statement tries again
 * rather than every request in the isolate failing on one transient error.
 */
export const lazyD1 = (getDb: () => D1Like): D1Like => {
  let ready: Promise<void> | undefined;
  const ensureSchema = (): Promise<void> => {
    ready ??= applyD1Schema(getDb()).catch((error) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };

  const statement = (sql: string, values: unknown[]): D1PreparedLike => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async first<T>() {
      await ensureSchema();
      return await getDb().prepare(sql).bind(...values).first<T>();
    },
    async all<T>() {
      await ensureSchema();
      return await getDb().prepare(sql).bind(...values).all<T>();
    },
    async run() {
      await ensureSchema();
      return await getDb().prepare(sql).bind(...values).run();
    },
  });

  return { prepare: (sql) => statement(sql, []) };
};

// Not "\u0000": SQLite treats an embedded NUL as the end of a TEXT value, so
// a key containing one would be silently truncated and the range scan below
// would miss it. NUL is escaped rather than used.
const SEP = "\u0001";

/**
 * Encode one key part with a type tag, escaping the separator so a part can
 * never fake a boundary. The tag keeps `1` and `"1"` distinct, as Deno KV
 * does.
 */
const encodePart = (part: KvKeyPart): string => {
  const tag = typeof part === "string"
    ? "s"
    : typeof part === "number"
    ? "n"
    : typeof part === "bigint"
    ? "B"
    : "b";
  const raw = String(part);
  return tag +
    raw
      .replaceAll("\\", "\\\\")
      .replaceAll("\u0000", "\\0")
      .replaceAll(SEP, "\\1");
};

/** Encode a full key into the ordered TEXT primary key. */
export const encodeKey = (key: KvKey): string => key.map(encodePart).join(SEP);

/**
 * Half-open range covering every key strictly below `prefix`, matching Deno
 * KV's `list({ prefix })`: descendants are included, the prefix key itself is
 * not.
 */
export const prefixRange = (prefix: KvKey): { lo: string; hi: string } => {
  const base = encodeKey(prefix);
  return { lo: base + SEP, hi: base + "\u0002" };
};

export class D1Repo<TVal> implements KvRepo<TVal, KvKeyPart, KvOptions> {
  constructor(
    private readonly db: D1Like,
    public prefix: KvKey = [],
    public options: KvOptions = {},
  ) {}

  genKey(): string {
    return monotonicUlid();
  }

  entry<TEntryVal = TVal>(
    key: KvKeyPart,
  ): KvEntryInterface<TEntryVal, KvKeyPart, KvOptions> {
    const fullKey = [...this.prefix, key];
    return this.entryForKey<TEntryVal>(key, fullKey);
  }

  private entryForKey<TEntryVal>(
    key: KvKeyPart,
    fullKey: KvKey,
  ): KvEntryInterface<TEntryVal, KvKeyPart, KvOptions> {
    const db = this.db;
    const encoded = encodeKey(fullKey);
    const repoOptions = this.options;

    const read = async (): Promise<
      { value: TEntryVal; version: number } | null
    > => {
      const row = await db
        .prepare(
          "SELECT value, version, expires_at FROM kv WHERE key = ?1",
        )
        .bind(encoded)
        .first<{ value: string; version: number; expires_at: number | null }>();
      if (!row) return null;
      // Expired rows stay until a sweep removes them; treat them as absent.
      if (row.expires_at != null && row.expires_at <= Date.now()) return null;
      return {
        value: JSON.parse(row.value) as TEntryVal,
        version: row.version,
      };
    };

    return {
      key,
      fullKey,
      async get(): Promise<TEntryVal | null> {
        return (await read())?.value ?? null;
      },
      async update(
        updater: (current: TEntryVal | null) => TEntryVal | null,
        opts: KvOptions = {},
      ): Promise<KvUpdateResult> {
        const current = await read();
        const updated = updater(current?.value ?? null);
        const expireIn = opts.expireIn ?? repoOptions.expireIn;
        const expiresAt = expireIn != null ? Date.now() + expireIn : null;

        if (updated === null) {
          if (!current) return { ok: true }; // already absent
          const res = await db
            .prepare("DELETE FROM kv WHERE key = ?1 AND version = ?2")
            .bind(encoded, current.version)
            .run();
          return { ok: res.meta.changes === 1 };
        }

        const encodedValue = JSON.stringify(updated);
        if (!current) {
          // CAS against "absent": loses harmlessly if another writer inserted
          // first, which is what makes single-use tokens single-use.
          const res = await db
            .prepare(
              "INSERT INTO kv (key, value, version, expires_at) VALUES (?1, ?2, 1, ?3) " +
                "ON CONFLICT (key) DO NOTHING",
            )
            .bind(encoded, encodedValue, expiresAt)
            .run();
          return { ok: res.meta.changes === 1 };
        }
        const res = await db
          .prepare(
            "UPDATE kv SET value = ?2, version = version + 1, expires_at = ?3 " +
              "WHERE key = ?1 AND version = ?4",
          )
          .bind(encoded, encodedValue, expiresAt, current.version)
          .run();
        return { ok: res.meta.changes === 1 };
      },
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<
    KvEntryInterface<TVal, KvKeyPart, KvOptions>
  > {
    const { lo, hi } = prefixRange(this.prefix);
    const { results } = await this.db
      .prepare(
        "SELECT key FROM kv WHERE key >= ?1 AND key < ?2 " +
          "AND (expires_at IS NULL OR expires_at > ?3) ORDER BY key",
      )
      .bind(lo, hi, Date.now())
      .all<{ key: string }>();

    for (const row of results) {
      const parts = decodeKey(row.key);
      const rest = parts.slice(this.prefix.length);
      if (rest.length === 0) continue;
      yield this.entryForKey<TVal>(rest[0], [...this.prefix, ...rest]);
    }
  }
}

/**
 * Inverse of the per-part escaping. A single left-to-right scan: two
 * `replaceAll` passes would be ambiguous, since a literal backslash followed
 * by `0` encodes to `\\0` and would otherwise be read as an escaped
 * separator, and `\u0000` so no NUL ever reaches SQLite.
 */
const unescapePart = (s: string): string => {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") {
      out += s[i];
      continue;
    }
    const next = s[++i];
    out += next === "0" ? "\u0000" : next === "1" ? SEP : next;
  }
  return out;
};

/** Inverse of {@link encodeKey}; used when listing a prefix. */
export const decodeKey = (encoded: string): KvKey => {
  if (encoded === "") return [];
  return encoded.split(SEP).map((chunk): KvKeyPart => {
    const tag = chunk[0];
    const raw = unescapePart(chunk.slice(1));
    switch (tag) {
      case "n":
        return Number(raw);
      case "B":
        return BigInt(raw);
      case "b":
        return raw === "true";
      default:
        return raw;
    }
  });
};

/** Delete rows whose TTL has passed. Run from a scheduled (cron) handler. */
export const sweepExpired = async (db: D1Like): Promise<number> => {
  const res = await db
    .prepare("DELETE FROM kv WHERE expires_at IS NOT NULL AND expires_at <= ?1")
    .bind(Date.now())
    .run();
  return res.meta.changes;
};
