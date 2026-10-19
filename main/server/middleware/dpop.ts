/**
 * DPoP session middleware — wires `@kbn/dpop-session-middleware` against the
 * shared session storage and the existing JTI replay store.
 */

import { DpopSession, dpopSession } from "@kbn/dpop-session-middleware";

import { dpopSessionStorage } from "../lib/session.ts";
import { jtiStore } from "../repository/jti-store.ts";

export { DpopSession };

export const dpop = dpopSession({
  sessionStorage: dpopSessionStorage,
  replayDetector: { check: (jti: string) => jtiStore.checkReplay(jti) },
});

export const sessionUserId = (
  session: DpopSession | undefined,
): string | undefined => {
  if (!session) return undefined;
  return (session.get("userId") as string | undefined) ?? undefined;
};
