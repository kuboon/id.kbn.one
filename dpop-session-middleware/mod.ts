/**
 * DPoP session middleware for Remix v3 (fetch-router).
 *
 * Verifies an RFC 9449 DPoP proof on every request and exposes the verified
 * key + persistent session under `context.get(DpopSession)`. When no DPoP
 * proof is present (or it's invalid) the middleware passes through without
 * setting the session — controllers/middleware can then decide how to react
 * (redirect to sign-in for HTML, return 401 for JSON, etc.).
 */

import type { Middleware } from "@remix-run/fetch-router";
import { Session, type SessionStorage } from "@remix-run/session";
import { computeThumbprint } from "@kuboon/dpop/common.ts";
import { verifyDpopProofFromRequest } from "@kuboon/dpop/server.ts";
import type { VerifyDpopProofOptions } from "@kuboon/dpop/types.ts";

export class DpopSession extends Session {
  readonly jwk: JsonWebKey;

  constructor(
    thumbprint: string,
    jwk: JsonWebKey,
    initialData?: Session["data"],
  ) {
    super(thumbprint, initialData);
    this.jwk = jwk;
  }

  get thumbprint(): string {
    return this.id;
  }

  override regenerateId(_deleteOldSession?: boolean): void {
    throw new Error(
      "Cannot regenerate ID of a DpopSession — the ID is derived from the client key",
    );
  }
}

export interface ReplayDetector {
  check(jti: string): boolean | Promise<boolean>;
}

export class InMemoryReplayDetector implements ReplayDetector {
  private seen = new Set<string>();
  check(jti: string): boolean {
    if (this.seen.has(jti)) return false;
    this.seen.add(jti);
    return true;
  }
}

export interface DpopSessionMiddlewareOptions {
  sessionStorage: SessionStorage;
  replayDetector?: ReplayDetector;
  maxAgeSeconds?: number;
  clockSkewSeconds?: number;
}

type SetDpopSessionContextTransform = readonly [
  readonly [typeof DpopSession, DpopSession],
];

export function dpopSession(
  options: DpopSessionMiddlewareOptions,
  // deno-lint-ignore no-explicit-any
): Middleware<any, any, SetDpopSessionContextTransform> {
  const { sessionStorage } = options;
  const replayDetector = options.replayDetector ?? new InMemoryReplayDetector();
  const maxAgeSeconds = options.maxAgeSeconds ?? 300;
  const clockSkewSeconds = options.clockSkewSeconds ?? 60;

  const verifyOptions: VerifyDpopProofOptions = {
    maxAgeSeconds,
    clockSkewSeconds,
    checkReplay: (jti: string) => replayDetector.check(jti),
  };

  return async (context, next) => {
    const result = await verifyDpopProofFromRequest(
      context.request,
      verifyOptions,
    );

    if (!result.valid) {
      // No or invalid DPoP — keep going so non-DPoP routes still work.
      return next();
    }

    const thumbprint = await computeThumbprint(result.jwk);
    const stored = await sessionStorage.read(thumbprint);
    const session = new DpopSession(thumbprint, result.jwk, stored.data);
    context.set(DpopSession, session);

    const response = await next();

    if (session !== context.get(DpopSession)) {
      throw new Error(
        "Cannot save DPoP session that was replaced by another middleware/handler",
      );
    }
    await sessionStorage.save(session);

    return response;
  };
}
