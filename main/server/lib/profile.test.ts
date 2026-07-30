/**
 * The user profile store: set / read / clear a nickname, independent of the
 * per-credential device nicknames.
 */

import { assertEquals } from "@std/assert";

import { deleteProfile, getNickname, setNickname } from "./profile.ts";

// Unique per run so the shared KV store can't leak state between tests.
const userId = () => `test-user-${crypto.randomUUID()}`;

Deno.test("nickname: unset reads as null", async () => {
  const id = userId();
  assertEquals(await getNickname(id), null);
});

Deno.test("nickname: set, trimmed, then read back", async () => {
  const id = userId();
  assertEquals(await setNickname(id, "  くぼーん  "), "くぼーん");
  assertEquals(await getNickname(id), "くぼーん");
  await deleteProfile(id);
});

Deno.test("nickname: an empty (or blank) value clears it", async () => {
  const id = userId();
  await setNickname(id, "clear me");
  assertEquals(await setNickname(id, "   "), null);
  assertEquals(await getNickname(id), null);
});

Deno.test("nickname: over-long values are truncated", async () => {
  const id = userId();
  const stored = await setNickname(id, "あ".repeat(100));
  assertEquals(stored?.length, 40);
  assertEquals(await getNickname(id), "あ".repeat(40));
  await deleteProfile(id);
});

Deno.test("deleteProfile drops the nickname", async () => {
  const id = userId();
  await setNickname(id, "gone soon");
  await deleteProfile(id);
  assertEquals(await getNickname(id), null);
});
