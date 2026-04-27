/**
 * Singleton repositories shared across controllers.
 */

import { DenoKvRepo, getKvInstance } from "@kbn/kv/denoKv.ts";
import { createKvSessionStorage } from "@kbn/session-storage-kv";
import {
  createSession,
  type Session,
  type SessionStorage,
} from "@remix-run/session";

import { DenoKvPasskeyRepository } from "./repository/deno-kv-passkey-store.ts";
import { PushService } from "./push/service.ts";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const sessionRepo = new DenoKvRepo<Session["data"]>(["dpop-session"], {
  expireIn: SESSION_TTL_MS,
});

export const dpopSessionStorage: SessionStorage = createKvSessionStorage(
  sessionRepo,
);

export const sessionRepository = {
  async update(
    thumbprint: string,
    updater: (
      current: { userId?: string } | null,
    ) => { userId?: string } | null,
  ): Promise<void> {
    const existing = await sessionRepo.entry(thumbprint).get();
    const currentValue = existing ? (existing[0] as { userId?: string }) : null;
    const next = updater(currentValue);
    if (next === null) {
      await sessionRepo.entry(thumbprint).update(() => null);
      return;
    }
    const session = createSession(thumbprint);
    for (const [k, v] of Object.entries(next)) {
      session.set(k, v);
    }
    await dpopSessionStorage.save(session);
  },
};

export const credentialRepository = await (async () => {
  const kv = await getKvInstance();
  return new DenoKvPasskeyRepository(kv);
})();

export const pushService = await (async () => {
  const kv = await getKvInstance();
  return await PushService.create(kv);
})();
