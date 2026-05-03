/**
 * One-shot KV migrations, run via `deno task pre-deploy`.
 *
 * Each migration is idempotent so it's safe to run repeatedly. New
 * migrations should be appended below and invoked from `main()`.
 */

import { getKvInstance } from "./kvInstance.ts";

interface OldVapidKeysRecord {
  keys: { publicKey: JsonWebKey; privateKey: JsonWebKey };
  createdAt: number;
  updatedAt: number;
}

interface NewSigningKeyRecord {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

/**
 * Move `["secret", "push_vapid_keys"]` to `["secret", "signing_key"]` and
 * unwrap `{ keys, createdAt, updatedAt }` → `{ publicKey, privateKey }`.
 */
const migrateSigningKey = async (kv: Deno.Kv): Promise<void> => {
  const oldKey: Deno.KvKey = ["secret", "push_vapid_keys"];
  const newKey: Deno.KvKey = ["secret", "signing_key"];

  const [oldEntry, newEntry] = await kv.getMany<
    [OldVapidKeysRecord, NewSigningKeyRecord]
  >([oldKey, newKey]);

  if (!oldEntry.value) {
    console.info("[migrate signing_key] nothing to migrate");
    return;
  }
  if (newEntry.value) {
    console.info(
      "[migrate signing_key] new key already present, deleting legacy entry only",
    );
    const result = await kv.atomic()
      .check(oldEntry)
      .delete(oldKey)
      .commit();
    if (!result.ok) {
      throw new Error("[migrate signing_key] failed to delete legacy entry");
    }
    return;
  }

  const { publicKey, privateKey } = oldEntry.value.keys;
  const result = await kv.atomic()
    .check(oldEntry)
    .check(newEntry)
    .set(newKey, { publicKey, privateKey } satisfies NewSigningKeyRecord)
    .delete(oldKey)
    .commit();
  if (!result.ok) {
    throw new Error("[migrate signing_key] atomic commit failed (race)");
  }
  console.info("[migrate signing_key] migrated");
};

const main = async () => {
  const kv = await getKvInstance();
  await migrateSigningKey(kv);
};

if (import.meta.main) {
  await main();
}
