import { decodeBase64Url } from "@std/encoding/base64url";
import { computeThumbprint } from "@kuboon/dpop/common.ts";
import type { SessionData } from "./types.ts";

const textDecoder = new TextDecoder();
const SESSION_EXPIRE_IN = 1000 * 60 * 60 * 24 * 7;

const extractJwkFromHeaderSegment = (segment: string): JsonWebKey | null => {
  let json: unknown;
  try {
    const bytes = decodeBase64Url(segment);
    json = JSON.parse(textDecoder.decode(bytes));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const jwk = (json as { jwk?: unknown }).jwk;
  if (!jwk || typeof jwk !== "object") return null;
  const record = jwk as Record<string, unknown>;
  if (
    record.kty !== "EC" ||
    record.crv !== "P-256" ||
    typeof record.x !== "string" ||
    typeof record.y !== "string"
  ) {
    return null;
  }
  return jwk as JsonWebKey;
};

export interface MigrationResult {
  scanned: number;
  migrated: number;
  alreadyMigrated: number;
  conflicts: number;
  unrecognized: number;
}

export const migrateSessionKeysToThumbprint = async (
  kv: Deno.Kv,
  options: { dryRun?: boolean } = {},
): Promise<MigrationResult> => {
  const dryRun = options.dryRun ?? false;
  const result: MigrationResult = {
    scanned: 0,
    migrated: 0,
    alreadyMigrated: 0,
    conflicts: 0,
    unrecognized: 0,
  };

  for await (
    const entry of kv.list<SessionData>({ prefix: ["session"] })
  ) {
    result.scanned++;
    const [, oldKey] = entry.key as [string, string];
    const jwk = extractJwkFromHeaderSegment(oldKey);
    if (!jwk) {
      // Already a thumbprint or not recognizable as a JWT header.
      result.unrecognized++;
      continue;
    }

    const thumbprint = await computeThumbprint(jwk);
    if (thumbprint === oldKey) {
      result.alreadyMigrated++;
      continue;
    }

    const newKvKey: Deno.KvKey = ["session", thumbprint];
    const existing = await kv.get<SessionData>(newKvKey);
    if (existing.value !== null) {
      console.warn(
        `skip: thumbprint key already exists for ${oldKey} -> ${thumbprint}`,
      );
      result.conflicts++;
      continue;
    }

    if (dryRun) {
      console.log(`would migrate ${oldKey} -> ${thumbprint}`);
      result.migrated++;
      continue;
    }

    const commit = await kv.atomic()
      .check({ key: newKvKey, versionstamp: null })
      .set(newKvKey, entry.value, { expireIn: SESSION_EXPIRE_IN })
      .delete(entry.key)
      .commit();

    if (!commit.ok) {
      console.warn(`commit failed for ${oldKey}`);
      result.conflicts++;
      continue;
    }
    result.migrated++;
    console.log(`migrated ${oldKey} -> ${thumbprint}`);
  }

  return result;
};

if (import.meta.main) {
  const dryRun = Deno.args.includes("--dry-run");
  const kv = await Deno.openKv(
    "https://api.deno.com/databases/ebf60f1f-4d3f-4402-ac49-fa60341278ed/connect",
  );
  try {
    const result = await migrateSessionKeysToThumbprint(kv, { dryRun });
    console.log(dryRun ? "dry-run result:" : "result:", result);
  } finally {
    kv.close();
  }
}
