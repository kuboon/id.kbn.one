/**
 * Turn a `kv-export.jsonl` into SQL for the D1 `kv` table.
 *
 *   deno run -A tools/migration/kv-import-d1.ts \
 *     --in ./kv-export.jsonl --out ./kv-import.sql
 *   wrangler d1 execute <DB> --remote --file ./kv-import.sql
 *
 * By default SQL is written to a file so the statements can be reviewed before
 * anything touches D1. Entries under an ephemeral prefix are skipped:
 * importing a stale replay or single-use marker would reject fresh tokens,
 * and an expired one protects nothing.
 *
 * With --apply the statements go straight to D1 over its REST API instead,
 * which is what CI uses so the secret-bearing SQL never touches the disk:
 *
 *   CLOUDFLARE_API_TOKEN=... deno run -A tools/migration/kv-import-d1.ts \
 *     --in ./kv-export.jsonl --apply \
 *     --account-id <ACCOUNT_ID> --database-id <DATABASE_ID>
 *
 * Pass --include-ephemeral to override, and --dry-run to only see the summary.
 *
 * Every run first reports what it found: counts per key prefix, and for any
 * entry D1 cannot hold, the key prefix and the *shape* of its value — type
 * names and string lengths, never contents, because the export carries the
 * signing key. Such an entry stops the import unless --skip-unstorable says
 * to drop it, so nothing is written half-way.
 *
 * @module
 */

import { parseArgs } from "@std/cli/parse-args";

import { D1_KV_SCHEMA, encodeKey } from "@kuboon/kv/d1.ts";

import { createD1HttpClient, type D1HttpClient } from "./d1-http.ts";
import {
  decodeKeyParts,
  decodeValue,
  type ExportedEntry,
  isEphemeral,
  type TaggedPart,
} from "./codec.ts";

/** Quote a string as a SQL literal. */
export const sqlString = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** How a value reads in an error without putting its contents in the log. */
const describe = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (typeof value === "object" && value !== null) {
    return Object.getPrototypeOf(value)?.constructor?.name ?? "object";
  }
  return typeof value;
};

/**
 * `D1KvRepo` stores values as JSON, so anything JSON cannot carry would arrive
 * changed — a `Uint8Array` as `{}`, an array hole as `null`. Reject it here,
 * naming the key and the path, instead of writing a row that reads back wrong.
 *
 * A property whose value is `undefined` is fine: JSON drops it, which is
 * exactly what the app's optional fields mean.
 */
export const assertJsonStorable = (
  value: unknown,
  path = "$",
): void => {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`non-finite number at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (v === undefined) {
        throw new TypeError(
          `undefined element at ${path}[${i}] (JSON would ` +
            "turn it into null)",
        );
      }
      assertJsonStorable(v, `${path}[${i}]`);
    });
    return;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      assertJsonStorable(v, `${path}.${k}`);
    }
    return;
  }
  throw new TypeError(`${describe(value)} at ${path} is not JSON-storable`);
};

/** `null` when the value is storable, else why it is not. */
export const storabilityError = (value: unknown): string | null => {
  try {
    assertJsonStorable(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/**
 * A value's structure with none of its content: type names, string and array
 * lengths, object keys. Safe to log — the export carries the signing key and
 * the passkey sign secret, so no value ever goes to the console.
 */
export const shapeOf = (value: unknown, depth = 0): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string(${value.length})`;
  if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
  if (value instanceof Date) return "Date";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (depth >= 3) return `array(${value.length})`;
    return `[${shapeOf(value[0], depth + 1)}${value.length > 1 ? ", …" : ""}]`;
  }
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return describe(value);
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    if (depth >= 3) return `object(${entries.length} keys)`;
    const shown = entries.slice(0, 8).map(([k, v]) =>
      `${k}: ${shapeOf(v, depth + 1)}`
    );
    if (entries.length > 8) shown.push("…");
    return `{ ${shown.join(", ")} }`;
  }
  return typeof value;
};

/**
 * How a key reads in a report. Only the first two parts are shown verbatim —
 * deeper parts are credential ids, subscription ids and usernames, which the
 * report has no reason to spell out.
 */
export const keyLabel = (key: readonly TaggedPart[]): string => {
  const head = key.slice(0, 2).map((p) => String(p.v)).join("/");
  return key.length > 2 ? `${head}/*` : head;
};

export const insertStatement = (
  key: readonly TaggedPart[],
  encodedValue: unknown,
): string => {
  const parts = decodeKeyParts(key);
  const encodedKey = encodeKey(
    parts as (string | number | bigint | boolean)[],
  );
  // The export is tagged (a Uint8Array arrives as `{$kvmig:"u8",…}`), so it has
  // to be decoded before storing: writing the tag verbatim would hand the app
  // the wrapper instead of the value.
  const value = decodeValue(encodedValue);
  try {
    assertJsonStorable(value);
  } catch (cause) {
    throw new TypeError(
      `${keyLabel(key)}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
  // The export carries no remaining TTL, so imported rows never expire; the
  // entries that rely on a TTL are the ephemeral ones we skip.
  return "INSERT INTO kv (key, value, version, expires_at) VALUES (" +
    `${sqlString(encodedKey)}, ${sqlString(JSON.stringify(value))}, 1, NULL) ` +
    "ON CONFLICT (key) DO UPDATE SET value = excluded.value, " +
    "version = kv.version + 1, expires_at = excluded.expires_at;";
};

/** The schema is one blob; D1 wants statements. */
export const splitSchema = (schema: string): string[] =>
  schema.split(";").map((s) => s.trim()).filter((s) => s.length > 0).map((s) =>
    s + ";"
  );

/** The D1 destination, from the flags and the environment. */
const d1Client = (
  args: { "account-id"?: string; "database-id"?: string },
): D1HttpClient => {
  const token = Deno.env.get("CLOUDFLARE_API_TOKEN");
  const accountId = args["account-id"] ?? Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = args["database-id"];
  if (!token || !accountId || !databaseId) {
    throw new Error(
      "needs CLOUDFLARE_API_TOKEN, an account id " +
        "(--account-id or CLOUDFLARE_ACCOUNT_ID) and --database-id",
    );
  }
  return createD1HttpClient({ accountId, databaseId, token });
};

const main = async () => {
  const args = parseArgs(Deno.args, {
    string: ["in", "out", "account-id", "database-id"],
    boolean: [
      "include-ephemeral",
      "dry-run",
      "apply",
      "skip-unstorable",
      "check-credentials",
    ],
    default: { in: "./kv-export.jsonl", out: "./kv-import.sql" },
  });

  // Checked before the export runs, so a broken credential does not cost a
  // read of the production database.
  if (args["check-credentials"]) {
    console.log("checking the D1 credential...");
    await d1Client(args).preflight();
    return;
  }

  const text = await Deno.readTextFile(args.in);
  const lines = text.split("\n").filter((l) => l.trim().length > 0);

  const statements: string[] = [];
  let skipped = 0;
  const kept = new Map<string, number>();
  const unstorable = new Map<string, { count: number; detail: string }>();

  for (const line of lines) {
    const row = JSON.parse(line) as ExportedEntry;
    if (!args["include-ephemeral"] && isEphemeral(row.key)) {
      skipped++;
      continue;
    }
    // Classify before building any SQL, so one bad entry reports itself
    // alongside the rest instead of aborting the run on the spot.
    const value = decodeValue(row.value);
    const problem = storabilityError(value);
    if (problem) {
      const label = keyLabel(row.key);
      const seen = unstorable.get(label);
      if (seen) seen.count++;
      else {unstorable.set(label, {
          count: 1,
          detail: `${problem} — ${shapeOf(value)}`,
        });}
      continue;
    }
    statements.push(insertStatement(row.key, row.value));
    const head = row.key[0]?.t === "s" ? String(row.key[0].v) : "?";
    kept.set(head, (kept.get(head) ?? 0) + 1);
  }

  console.log(`read ${lines.length} entries`);
  console.log(`  keeping ${statements.length}, skipping ${skipped} ephemeral`);
  for (const [prefix, n] of [...kept].sort()) console.log(`  ${prefix}: ${n}`);

  if (unstorable.size > 0) {
    // D1KvRepo stores JSON, so the app itself can no longer write these shapes:
    // they are leftovers from an earlier implementation. Shapes only — never
    // the values, which include key material.
    const total = [...unstorable.values()].reduce((n, u) => n + u.count, 0);
    console.log(`\n${total} entries D1 cannot hold:`);
    for (const [label, { count, detail }] of [...unstorable].sort()) {
      console.log(`  ${label} (${count}): ${detail}`);
    }
    if (!args["skip-unstorable"]) {
      throw new Error(
        `refusing to import: ${total} entries cannot be stored as JSON. ` +
          "Check the shapes above against the code that reads those keys, " +
          "then pass --skip-unstorable to drop them.",
      );
    }
    console.log("  (dropped: --skip-unstorable)");
  }

  if (args["dry-run"]) return;

  if (args.apply) {
    const client = d1Client(args);
    console.log("\nchecking the D1 credential...");
    await client.preflight();
    console.log("applying schema...");
    await client.run(splitSchema(D1_KV_SCHEMA));
    console.log("applying data...");
    await client.run(statements);
    console.log("done; nothing written to disk");
    return;
  }

  await Deno.writeTextFile(
    args.out,
    "-- Generated by tools/migration/kv-import-d1.ts. Contains secrets.\n" +
      statements.join("\n") + "\n",
  );
  console.log(`\nwrote ${args.out}`);
  console.log(
    "This file contains secrets; delete it once the import is verified.",
  );
};

if (import.meta.main) await main();
