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
  updateSession: (_c, _userId) => undefined,
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
    json: { displayName: "たろう" },
  });

  assertEquals(res.status, 200);
  if (res.ok) {
    const data = await res.json();
    // response now includes options and session token
    assertEquals(typeof data.options !== "undefined", true);
    assertEquals(typeof data.sessionToken === "string", true);
    // The passkey is labelled with the display name; the user id is a fresh UUID.
    assertEquals(data.options.user.name, "たろう");
    const id = new TextDecoder().decode(
      Uint8Array.fromBase64(data.options.user.id, { alphabet: "base64url" }),
    );
    assertEquals(/^[0-9a-f-]{36}$/.test(id), true);
  }
});

Deno.test("register/options ignores a client-chosen userId", async () => {
  await storage.addCredential({
    id: "cred-alice",
    userId: "alice",
    nickname: "",
    publicKey: "",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    createdAt: 0,
    updatedAt: 0,
  });
  const res = await appFetch(
    new Request("http://localhost/register/options", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice" }),
    }),
  );
  assertEquals(res.status, 200);
  const data = await res.json();
  const id = new TextDecoder().decode(
    Uint8Array.fromBase64(data.options.user.id, { alphabet: "base64url" }),
  );
  assertEquals(id === "alice", false);
});

Deno.test("PasskeyAppType RPC - authenticate/options endpoint", async () => {
  const res = await client.authenticate.options.$post();

  assertEquals(res.status, 200);
  if (res.ok) {
    const data = await res.json();
    assertEquals(typeof data.options !== "undefined", true);
    assertEquals(typeof data.sessionToken === "string", true);
  }
});

Deno.test("PasskeyAppType RPC - authenticate/verify returns rpId for unknown credential", async () => {
  const optionsRes = await client.authenticate.options.$post();
  assertEquals(optionsRes.status, 200);
  const { sessionToken } = await optionsRes.json();

  const verifyRes = await client.authenticate.verify.$post({
    json: {
      credential: { id: "unknown-credential-id" },
      sessionToken,
    },
  });

  assertEquals(verifyRes.status, 401);
  const body = await verifyRes.json() as { message?: string; rpId?: string };
  assertEquals(body.message, "Credential not found");
  // rpId lets the client call PublicKeyCredential.signalUnknownCredential so
  // the stale passkey can be removed from the user's device.
  assertEquals(body.rpId, "localhost");
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
      header: (name: string) =>
        name === "origin" ? "invalid-origin" : undefined,
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
