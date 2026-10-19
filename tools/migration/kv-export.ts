/**
 * Export every entry from a Deno KV database to JSONL, for the Cloudflare
 * migration.
 *
 * Run against production (needs a Deno Deploy access token):
 *
 *   DENO_KV_ACCESS_TOKEN=... deno run -A tools/migration/kv-export.ts \
 *     --database <DATABASE_ID> --out ./kv-export.jsonl
 *
 * `--database` is expanded to the v2 connect URL; pass `--url` to give one
 * verbatim. Omit both to read the local development database instead.
 *
 * THE OUTPUT CONTAINS SECRETS — the JWS/VAPID signing key and the passkey
 * signing secret. Keep it out of git, off shared storage, and delete it once
 * the import is verified.
 *
 * @module
 */

import { parseArgs } from "@std/cli/parse-args";

import { encodeKeyParts, encodeValue, type ExportedEntry } from "./codec.ts";

/** Deno Deploy's KV connect endpoint for a database id (v2). */
export const connectUrl = (databaseId: string): string =>
  `https://api.deno.com/v2/databases/${databaseId}/connect`;

const main = async () => {
  const args = parseArgs(Deno.args, {
    string: ["url", "database", "out"],
    default: { out: "./kv-export.jsonl" },
  });

  const url = args.url ??
    (args.database ? connectUrl(args.database) : undefined);
  const kv = url ? await Deno.openKv(url) : await Deno.openKv();
  const file = await Deno.open(args.out, {
    write: true,
    create: true,
    truncate: true,
  });
  const encoder = new TextEncoder();

  let count = 0;
  const byPrefix = new Map<string, number>();
  try {
    for await (const entry of kv.list({ prefix: [] })) {
      const key = encodeKeyParts(entry.key);
      const row: ExportedEntry = {
        key,
        value: encodeValue(entry.value),
      };
      await file.write(encoder.encode(JSON.stringify(row) + "\n"));
      count++;
      const head = String(entry.key[0] ?? "");
      byPrefix.set(head, (byPrefix.get(head) ?? 0) + 1);
    }
  } finally {
    file.close();
    kv.close();
  }

  console.log(`exported ${count} entries -> ${args.out}`);
  for (const [prefix, n] of [...byPrefix].sort()) {
    console.log(`  ${prefix}: ${n}`);
  }
  // Deno KV does not expose a key's remaining TTL, so expiring entries are
  // exported without one; the import drops them anyway (see EPHEMERAL_PREFIXES).
  console.log(
    "\nThis file contains secrets (signing key, passkey sign secret). " +
      "Do not commit it; delete it once the import is verified.",
  );
};

if (import.meta.main) await main();
