import type { DenoKvPasskeyRepository } from "../repository/deno-kv-passkey-store.ts";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";

export type CredentialsRouterOptions = {
  credentialStore: DenoKvPasskeyRepository;
  ensureAuthenticatedUser: (c: Context) => string;
  setNoStore: (c: Context) => void;
};

export function createCredentialsRouter(
  { credentialStore, ensureAuthenticatedUser, setNoStore }:
    CredentialsRouterOptions,
) {
  const app = new Hono();

  app.get("/", async (c) => {
    setNoStore(c);
    const userId = ensureAuthenticatedUser(c);
    const credentials = await credentialStore.getCredentialsByUserId(userId);
    return c.json({ userId, credentials });
  });

  app.delete("/:credentialId", async (c) => {
    setNoStore(c);
    const userId = ensureAuthenticatedUser(c);
    const credentialId = c.req.param("credentialId");
    if (!credentialId) {
      throw new HTTPException(400, {
        message: "Missing credential identifier",
      });
    }
    const credential = await credentialStore.getCredentialById(credentialId);
    if (!credential || credential.userId !== userId) {
      throw new HTTPException(404, { message: "Credential not found" });
    }
    await credentialStore.deleteCredential(credentialId);
    return c.json({ success: true });
  });

  app.patch("/:credentialId", async (c) => {
    setNoStore(c);
    const userId = ensureAuthenticatedUser(c);
    const credentialId = c.req.param("credentialId");
    if (!credentialId) {
      throw new HTTPException(400, {
        message: "Missing credential identifier",
      });
    }
    const body = await c.req.json<{ nickname?: string }>();
    const nickname = body.nickname?.trim();
    if (!nickname) {
      throw new HTTPException(400, { message: "nickname is required" });
    }
    const credential = await credentialStore.getCredentialById(credentialId);
    if (!credential || credential.userId !== userId) {
      throw new HTTPException(404, { message: "Credential not found" });
    }
    if (credential.nickname !== nickname) {
      credential.nickname = nickname;
      credential.updatedAt = Date.now();
      await credentialStore.updateCredential(credential);
    }
    return c.json({ credential });
  });

  return app;
}
