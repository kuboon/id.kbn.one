import { createKvSessionStorage } from "@kbn/session-storage-kv";
import { createSession, type SessionStorage } from "@remix-run/session";

import { sessionRepo } from "../repositories.ts";

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
