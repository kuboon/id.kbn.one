/**
 * POST /token — OAuth 2.0 / OIDC token endpoint.
 *
 * Public clients only (PKCE-protected). Accepts
 * `application/x-www-form-urlencoded` per RFC 6749 §4.1.3 and returns
 * `id_token` + `access_token` for grant_type=authorization_code.
 *
 * Errors follow RFC 6749 §5.2 (`{error, error_description}`).
 */

import type { RequestContext } from "@remix-run/fetch-router";

import { idpOrigin } from "#server/config.ts";
import { signJwt } from "#server/lib/jwt.ts";
import { buildUserClaims } from "../claims.ts";
import { consumeAuthorizationCode } from "../code-store.ts";
import { verifyPkceS256 } from "../pkce.ts";

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const ID_TOKEN_TTL_SECONDS = 3600;

type TokenError =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unsupported_grant_type";

const errorResponse = (
  error: TokenError,
  description: string,
  status = 400,
): Response =>
  new Response(
    JSON.stringify({ error, error_description: description }),
    {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "pragma": "no-cache",
      },
    },
  );

const noStoreJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "pragma": "no-cache",
    },
  });

const parseBody = async (
  request: Request,
): Promise<URLSearchParams | null> => {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/x-www-form-urlencoded")) return null;
  const text = await request.text();
  return new URLSearchParams(text);
};

export const tokenAction = async (
  context: RequestContext,
): Promise<Response> => {
  const form = await parseBody(context.request);
  if (!form) {
    return errorResponse(
      "invalid_request",
      "Content-Type must be application/x-www-form-urlencoded",
    );
  }
  const grantType = form.get("grant_type") ?? "";
  if (grantType !== "authorization_code") {
    return errorResponse(
      "unsupported_grant_type",
      "Only authorization_code is supported",
    );
  }
  const code = form.get("code") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const clientId = form.get("client_id") ?? "";
  const codeVerifier = form.get("code_verifier") ?? "";
  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return errorResponse(
      "invalid_request",
      "code, redirect_uri, client_id and code_verifier are required",
    );
  }

  const record = await consumeAuthorizationCode(code);
  if (!record) {
    return errorResponse("invalid_grant", "code is invalid or expired");
  }
  if (record.client_id !== clientId) {
    return errorResponse(
      "invalid_client",
      "client_id does not match the authorization request",
    );
  }
  if (record.redirect_uri !== redirectUri) {
    return errorResponse(
      "invalid_grant",
      "redirect_uri does not match the authorization request",
    );
  }
  const ok = await verifyPkceS256(codeVerifier, record.code_challenge);
  if (!ok) {
    return errorResponse("invalid_grant", "PKCE verification failed");
  }

  const now = Math.floor(Date.now() / 1000);
  const userClaims = buildUserClaims(record.user_id, record.scope);
  const idToken = await signJwt({
    ...userClaims,
    iss: idpOrigin,
    aud: record.client_id,
    exp: now + ID_TOKEN_TTL_SECONDS,
    iat: now,
    auth_time: record.auth_time,
    nonce: record.nonce,
    jti: crypto.randomUUID(),
  });
  const accessToken = await signJwt({
    iss: idpOrigin,
    sub: record.user_id,
    aud: `${idpOrigin}/userinfo`,
    client_id: record.client_id,
    scope: record.scope,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    iat: now,
    nbf: now,
    jti: crypto.randomUUID(),
  });

  return noStoreJson({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    id_token: idToken,
    scope: record.scope,
  });
};
