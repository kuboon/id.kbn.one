import type { PasskeyAppType } from "./mod.ts";
import { createPasskeysRouter, getRequestUrl } from "./mod.ts";
import type { PasskeyMiddlewareOptions } from "../core/types.ts";
import { InMemoryPasskeyRepository } from "../core/in-memory-passkey-store.ts";

import { hc } from "hono/client";
import { assertEquals, assertThrows } from "@std/assert";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";

const storage = new InMemoryPasskeyRepository();
const options: PasskeyMiddlewareOptions = {
  rpID: "Test RP",
  rpName: "localhost",
  storage,
  getUserId: (c) => c.var.session?.userId,
};

const app = createPasskeysRouter(options);
const appFetch = app.fetch.bind(app);
const client = hc<PasskeyAppType>("http://localhost", {
  fetch(input: RequestInfo | URL, init?: RequestInit) {
    return appFetch(new Request(input, init));
  },
});
Deno.test("PasskeyAppType RPC - register/options endpoint", async () => {
  const res = await client.register.options.$post({
    json: { userId: "test-user-123" },
  });

  assertEquals(res.status, 200);
  if (res.ok) {
    const data = await res.json();
    assertEquals(typeof data.challenge, "string");
    assertEquals(data.user.name, "test-user-123");
  }
});

Deno.test("PasskeyAppType RPC - authenticate/options endpoint", async () => {
  const res = await client.authenticate.options.$post();

  assertEquals(res.status, 200);
  if (res.ok) {
    const data = await res.json();
    assertEquals(typeof data.challenge, "string");
    assertEquals(data.userVerification, "preferred");
  }
});

Deno.test("PasskeyAppType RPC - type safety check", () => {
  // This test verifies that the types are correctly inferred
  const client = hc<PasskeyAppType>("http://localhost");

  // The TypeScript compiler will ensure these paths exist
  const _registerOptions = client["register"]["options"];
  const _registerVerify = client["register"]["verify"];
  const _authenticateOptions = client["authenticate"]["options"];
  const _authenticateVerify = client["authenticate"]["verify"];

  // Type check passes if this compiles
  assertEquals(true, true);
});

Deno.test("getRequestUrl - should throw 400 for invalid URL in request", () => {
  const mockContext = {
    req: {
      header: () => undefined,
      url: "invalid-url",
    },
  } as unknown as Context;

  const error = assertThrows(
    () => getRequestUrl(mockContext),
    HTTPException,
  );
  assertEquals(error.status, 400);
  assertEquals(error.message, "Unable to determine request origin");
});

Deno.test("getRequestUrl - should throw 400 for invalid Origin header", () => {
  const mockContext = {
    req: {
      header: (name: string) => name === "origin" ? "invalid-origin" : undefined,
      url: "http://localhost",
    },
  } as unknown as Context;

  const error = assertThrows(
    () => getRequestUrl(mockContext),
    HTTPException,
  );
  assertEquals(error.status, 400);
  assertEquals(error.message, "Unable to determine request origin");
});

Deno.test("getRequestUrl - should return URL from Origin header", () => {
  const mockContext = {
    req: {
      header: (name: string) =>
        name === "origin" ? "http://example.com" : undefined,
      url: "http://localhost",
    },
  } as unknown as Context;

  const url = getRequestUrl(mockContext);
  assertEquals(url.origin, "http://example.com");
});

Deno.test("getRequestUrl - should return URL from request URL if Origin is missing", () => {
  const mockContext = {
    req: {
      header: () => undefined,
      url: "http://localhost/path",
    },
  } as unknown as Context;

  const url = getRequestUrl(mockContext);
  assertEquals(url.origin, "http://localhost");
});
