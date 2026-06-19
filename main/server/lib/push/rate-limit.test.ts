import { assert, assertEquals } from "@std/assert";
import { DenoKvRepo } from "@kbn/kv/denoKv.ts";

import { PushRateLimiter } from "./rate-limit.ts";

const uniquePrefix = () => ["test", "ratelimit", crypto.randomUUID()];

Deno.test("PushRateLimiter: allows up to the limit, then throttles", async () => {
  const repo = new DenoKvRepo<number>(uniquePrefix());
  const limiter = new PushRateLimiter(repo, 3, 60_000, () => 0);

  assertEquals(await limiter.tryAcquire("sub-1"), true);
  assertEquals(await limiter.tryAcquire("sub-1"), true);
  assertEquals(await limiter.tryAcquire("sub-1"), true);
  assertEquals(await limiter.tryAcquire("sub-1"), false);
  assertEquals(await limiter.tryAcquire("sub-1"), false);
});

Deno.test("PushRateLimiter: counts each subscription independently", async () => {
  const repo = new DenoKvRepo<number>(uniquePrefix());
  const limiter = new PushRateLimiter(repo, 1, 60_000, () => 0);

  assertEquals(await limiter.tryAcquire("a"), true);
  assertEquals(await limiter.tryAcquire("a"), false);
  // A different subscription is unaffected.
  assertEquals(await limiter.tryAcquire("b"), true);
});

Deno.test("PushRateLimiter: resets in a new time window", async () => {
  const repo = new DenoKvRepo<number>(uniquePrefix());
  let now = 0;
  const limiter = new PushRateLimiter(repo, 1, 1_000, () => now);

  assertEquals(await limiter.tryAcquire("sub"), true);
  assertEquals(await limiter.tryAcquire("sub"), false);
  // Advance past the window boundary.
  now = 1_000;
  assertEquals(await limiter.tryAcquire("sub"), true);
});

Deno.test("PushRateLimiter: a non-positive limit disables throttling", async () => {
  const repo = new DenoKvRepo<number>(uniquePrefix());
  const limiter = new PushRateLimiter(repo, 0, 60_000, () => 0);
  for (let i = 0; i < 50; i++) {
    assert(await limiter.tryAcquire("sub"));
  }
});
