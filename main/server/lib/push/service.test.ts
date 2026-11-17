import { assert, assertEquals, assertRejects } from "@std/assert";

import { getPushService } from "./service.ts";

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  new Uint8Array(bytes).toBase64({ alphabet: "base64url", omitPadding: true });

/** A subscription as a browser would send it, at a fresh endpoint. */
async function browserSubscription() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    endpoint:
      `https://updates.push.services.mozilla.com/wpush/v2/${crypto.randomUUID()}`,
    keys: {
      p256dh: b64url(await crypto.subtle.exportKey("raw", keys.publicKey)),
      auth: b64url(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}

/**
 * Runs `test` with `fetch` answering push requests from `answers` in turn
 * (201 once they run out), recording each request's headers.
 */
async function withPushService(
  answers: (() => Response)[],
  test: (seen: Headers[]) => Promise<void>,
) {
  const seen: Headers[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers ?? (input as Request).headers));
    return Promise.resolve(
      (answers.shift() ?? (() => new Response(null, { status: 201 })))(),
    );
  }) as typeof fetch;
  try {
    await test(seen);
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function subscribed() {
  const push = await getPushService();
  const userId = `test-${crypto.randomUUID()}`;
  const stored = await push.upsertSubscription(
    userId,
    await browserSubscription(),
  );
  return { push, userId, id: stored.id };
}

Deno.test("PushService: a delivered notification records the success", async () => {
  const { push, userId, id } = await subscribed();
  await withPushService([], async (seen) => {
    const result = await push.sendNotification(userId, id, {
      title: "t",
      body: "b",
      topic: "inbox",
    });
    assert(!result.removed);
    assertEquals(result.warnings, []);
    assert(result.subscription.metadata.lastSuccessfulSendAt);
    assertEquals(seen.length, 1);
    assertEquals(seen[0].get("ttl"), "2419200");
    assertEquals(seen[0].get("urgency"), "normal");
    assertEquals(seen[0].get("topic"), "inbox");
    assertEquals(seen[0].get("content-encoding"), "aes128gcm");
  });
});

Deno.test("PushService: an expired subscription (410) is removed", async () => {
  const { push, userId, id } = await subscribed();
  await withPushService(
    [() => new Response("gone", { status: 410 })],
    async () => {
      const result = await push.sendNotification(userId, id, {
        title: "t",
        body: "b",
      });
      assertEquals(result.removed, true);
      assertEquals(await push.listSubscriptions(userId), []);
    },
  );
});

Deno.test("PushService: a VAPID key mismatch removes the subscription and says why", async () => {
  const { push, userId, id } = await subscribed();
  await withPushService([
    () => Response.json({ reason: "VapidPkHashMismatch" }, { status: 400 }),
  ], async () => {
    const result = await push.sendNotification(userId, id, {
      title: "t",
      body: "b",
    });
    assertEquals(result.removed, true);
    assert(result.warnings?.[0].includes("VAPID"));
    assertEquals(await push.listSubscriptions(userId), []);
  });
});

Deno.test("PushService: a rejected Topic is dropped, with a warning", async () => {
  const { push, userId, id } = await subscribed();
  await withPushService([
    () => Response.json({ reason: "BadWebPushTopic" }, { status: 400 }),
  ], async (seen) => {
    const result = await push.sendNotification(userId, id, {
      title: "t",
      body: "b",
      topic: "bad topic",
    });
    assert(!result.removed);
    assert(result.warnings?.[0].includes("Topic"));
    assertEquals(seen.map((h) => h.get("topic")), ["bad topic", null]);
  });
});

Deno.test("PushService: other refusals throw and are recorded, keeping the subscription", async () => {
  const { push, userId, id } = await subscribed();
  await withPushService(
    [() => new Response("busy", { status: 500 })],
    async () => {
      await assertRejects(
        () => push.sendNotification(userId, id, { title: "t", body: "b" }),
        Error,
        "500",
      );
      const [kept] = await push.listSubscriptions(userId);
      assertEquals(kept.id, id);
      assert(kept.metadata.lastError?.includes("busy"));
    },
  );
});
