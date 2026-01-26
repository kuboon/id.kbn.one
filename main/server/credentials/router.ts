import type { DenoKvPasskeyRepository } from "../repository/deno-kv-passkey-store.ts";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import { sValidator } from "@hono/standard-validator";
import {
  credentialIdParamSchema,
  updateNicknameBodySchema,
} from "./schemas.ts";

export type CredentialsRouterOptions = {
  credentialStore: DenoKvPasskeyRepository;
  ensureAuthenticatedUser: (c: Context) => string;
  setNoStore: (c: Context) => void;
};

export function createCredentialsRouter(
  { credentialStore, ensureAuthenticatedUser, setNoStore }:
    CredentialsRouterOptions,
) {
  const app = new Hono() //.basePath("/credentials")
    .get("/", async (c) => {
      setNoStore(c);
      const userId = ensureAuthenticatedUser(c);
      const credentials = await credentialStore.getCredentialsByUserId(userId);
      return c.json({ userId, credentials });
    }).delete(
      "/:credentialId",
      sValidator("param", credentialIdParamSchema),
      async (c) => {
        setNoStore(c);
        const userId = ensureAuthenticatedUser(c);
        const { credentialId } = c.req.valid("param");
        const credential = await credentialStore.getCredentialById(
          credentialId,
        );
        if (!credential || credential.userId !== userId) {
          throw new HTTPException(404, { message: "Credential not found" });
        }
        await credentialStore.deleteCredential(credentialId);
        return c.json({ success: true });
      },
    ).patch(
      "/:credentialId",
      sValidator("param", credentialIdParamSchema),
      sValidator("json", updateNicknameBodySchema),
      async (c) => {
        setNoStore(c);
        const userId = ensureAuthenticatedUser(c);
        const { credentialId } = c.req.valid("param");
        const { nickname } = c.req.valid("json");
        const credential = await credentialStore.getCredentialById(
          credentialId,
        );
        if (!credential || credential.userId !== userId) {
          throw new HTTPException(404, { message: "Credential not found" });
        }
        if (credential.nickname !== nickname) {
          credential.nickname = nickname;
          credential.updatedAt = Date.now();
          await credentialStore.updateCredential(credential);
        }
        return c.json({ credential });
      },
    );

  return app;
}
