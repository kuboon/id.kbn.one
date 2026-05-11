/**
 * GET /userinfo — OIDC UserInfo endpoint (OIDC Core 1.0 §5.3).
 *
 * Authenticates with `Authorization: Bearer <access_token>` issued by
 * `/token`. The access_token is a JWS signed with the IdP's signing key;
 * we verify it against the local JWKS, check `aud` matches this endpoint,
 * and gate optional claims (`profile`, `email`) by the `scope` it carries.
 */

import type { RequestContext } from "@remix-run/fetch-router";
import { createLocalJWKSet, jwtVerify } from "jose";

import { idpOrigin } from "#server/config.ts";
import { getSigningKey } from "#server/lib/signing-key.ts";
import { buildUserClaims } from "../claims.ts";

const wwwAuthenticate = (error: string, description: string): string =>
  `Bearer error="${error}", error_description="${description}"`;

const unauthorized = (error: string, description: string): Response =>
  new Response(JSON.stringify({ error, error_description: description }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "www-authenticate": wwwAuthenticate(error, description),
    },
  });

const verifyAccessToken = async (token: string) => {
  const { publicJwk } = await getSigningKey();
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  return await jwtVerify(token, jwks, {
    issuer: idpOrigin,
    audience: `${idpOrigin}/userinfo`,
  });
};

export const userinfoAction = async (
  context: RequestContext,
): Promise<Response> => {
  const auth = context.request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return unauthorized("invalid_token", "Missing Bearer access token");
  }
  const token = match[1].trim();
  let sub: string;
  let scope: string;
  try {
    const { payload } = await verifyAccessToken(token);
    if (typeof payload.sub !== "string") {
      return unauthorized("invalid_token", "Token has no subject");
    }
    sub = payload.sub;
    scope = typeof payload.scope === "string" ? payload.scope : "openid";
  } catch (e) {
    const description = e instanceof Error ? e.message : "Invalid access token";
    return unauthorized("invalid_token", description);
  }
  return new Response(JSON.stringify(buildUserClaims(sub, scope)), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
};
