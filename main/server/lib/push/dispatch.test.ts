import { assertEquals } from "@std/assert";
import { type } from "arktype";

import { pushNotificationContentSchema } from "./schemas.ts";
import { toServicePayload } from "./dispatch.ts";

Deno.test("pushNotificationContentSchema: accepts a non-negative integer badgeCount", () => {
  const result = pushNotificationContentSchema({
    title: "t",
    body: "b",
    badgeCount: 3,
  });
  assertEquals(result instanceof type.errors, false);
});

Deno.test("pushNotificationContentSchema: accepts badgeCount 0 (clear)", () => {
  const result = pushNotificationContentSchema({
    title: "t",
    body: "b",
    badgeCount: 0,
  });
  assertEquals(result instanceof type.errors, false);
});

Deno.test("pushNotificationContentSchema: rejects negative / non-integer badgeCount", () => {
  assertEquals(
    pushNotificationContentSchema({
      title: "t",
      body: "b",
      badgeCount: -1,
    }) instanceof
      type.errors,
    true,
  );
  assertEquals(
    pushNotificationContentSchema({
      title: "t",
      body: "b",
      badgeCount: 1.5,
    }) instanceof
      type.errors,
    true,
  );
});

Deno.test("toServicePayload: passes badgeCount through", () => {
  const payload = toServicePayload({ title: "t", body: "b", badgeCount: 5 });
  assertEquals(payload.badgeCount, 5);
});

Deno.test("toServicePayload: badgeCount is undefined when omitted", () => {
  const payload = toServicePayload({ title: "t", body: "b" });
  assertEquals(payload.badgeCount, undefined);
});
