/**
 * KV-backed session storage for Remix v3.
 *
 * Adapts any `@kbn/kv` `KvRepo` to the `SessionStorage` interface from
 * `@remix-run/session`. Session IDs are used as KV keys; session data is
 * stored as the `[valueData, flashData]` tuple produced by `Session#data`.
 */

import {
  createSession,
  type Session,
  type SessionStorage,
} from "@remix-run/session";
import type { KvRepo } from "@kbn/kv/types.ts";

type SessionDataTuple = Session["data"];

export function createKvSessionStorage(
  repo: KvRepo<SessionDataTuple>,
): SessionStorage {
  return {
    async read(id: string | null): Promise<Session> {
      if (id) {
        const data = await repo.entry(id).get();
        if (data !== null) {
          return createSession(id, data);
        }
      }
      return createSession(id ?? undefined);
    },
    async save(session: Session): Promise<string | null> {
      if (session.deleteId) {
        await repo.entry(session.deleteId).update(() => null);
      }

      if (session.destroyed) {
        await repo.entry(session.id).update(() => null);
        return "";
      }

      if (session.dirty) {
        await repo.entry(session.id).update(() => session.data);
        return session.id;
      }

      return null;
    },
  };
}
