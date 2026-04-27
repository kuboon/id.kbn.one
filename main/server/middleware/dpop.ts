/**
 * DPoP session middleware — wires `@kbn/dpop-session-middleware` against the
 * shared session storage and the existing JTI replay store.
 */

import { DpopSession, dpopSession } from "@kbn/dpop-session-middleware";

import { dpopSessionStorage } from "../repositories.ts";
import { DenoKvJtiStore } from "../repository/deno-kv-jti-store.ts";
import { getKvInstance } from "../kvInstance.ts";

export { DpopSession };

class KvReplayDetector {
  private store: Promise<DenoKvJtiStore>;
  constructor() {
    this.store = getKvInstance().then((kv) => new DenoKvJtiStore(kv));
  }
  async check(jti: string): Promise<boolean> {
    return await (await this.store).checkReplay(jti);
  }
}

export const dpop = dpopSession({
  sessionStorage: dpopSessionStorage,
  replayDetector: new KvReplayDetector(),
});

export const sessionUserId = (
  session: DpopSession | undefined,
): string | undefined => {
  if (!session) return undefined;
  return (session.get("userId") as string | undefined) ?? undefined;
};
