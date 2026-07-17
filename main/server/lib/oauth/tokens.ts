/**
 * OAuth token minting/verification for the MCP authorization server.
 *
 * Authorization codes, access tokens, and refresh tokens are all **signed
 * JWTs** (ES256, the IdP's shared signing key) — no random secret is stored;
 * validity is proven by the signature. The only server-side state is a small
 * "consumed jti" marker in KV that makes codes single-use and gives refresh
 * tokens rotation with reuse detection (OAuth 2.1 for public clients).
 *
 * Token `typ` headers keep the three kinds from being interchanged:
 *   - `oauth-authz-code+jwt` — authorization code
 *   - `at+jwt`               — access token (RFC 9068)
 *   - `oauth-refresh+jwt`    — refresh token
 */

import { CompactSign, type JWTPayload, jwtVerify } from "jose";

import { idpOrigin } from "../../config.ts";
import { getSigningKey } from "../signing-key.ts";
import { oauthConsumedRepo } from "../../repositories.ts";
import { verifyPkceS256 } from "./pkce.ts";

const AUTHZ_REQ_TYP = "oauth-authz-request+jwt";
const CODE_TYP = "oauth-authz-code+jwt";
const ACCESS_TYP = "at+jwt";
const REFRESH_TYP = "oauth-refresh+jwt";

const AUTHZ_REQ_TTL_S = 600; // 10 min to log in + consent
const CODE_TTL_S = 60;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

/** OAuth error surfaced to the token endpoint (RFC 6749 §5.2). */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly status = 400,
    readonly description?: string,
  ) {
    super(description ?? error);
  }
}

const sign = async (typ: string, claims: JWTPayload): Promise<string> => {
  const { keyPair, kid } = await getSigningKey();
  return await new CompactSign(encoder.encode(JSON.stringify(claims)))
    .setProtectedHeader({ alg: "ES256", typ, kid })
    .sign(keyPair.privateKey);
};

const verify = async (token: string, typ: string): Promise<JWTPayload> => {
  const { keyPair } = await getSigningKey();
  const { payload } = await jwtVerify(token, keyPair.publicKey, {
    issuer: idpOrigin,
    typ,
    algorithms: ["ES256"],
  });
  return payload;
};

/**
 * Atomically mark `jti` consumed. Returns true on the first call (allowed),
 * false if it was already consumed (replay / rotation reuse) or lost the race.
 */
const consumeOnce = async (jti: string, ttlS: number): Promise<boolean> => {
  let first = false;
  const result = await oauthConsumedRepo.entry(jti).update((current) => {
    if (current) {
      first = false;
      return current;
    }
    first = true;
    return true;
  }, { expireIn: Math.max(ttlS, 1) * 1000 });
  return first && result.ok;
};

export interface AuthzRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  state?: string;
}

/**
 * Sign the validated authorization request (from `GET /oauth/authorize`) into a
 * short-lived token. It is carried by the consent page and presented back to
 * `POST /oauth/authorize/approve`, so the request cannot be tampered with and
 * the CIMD client does not need to be re-fetched to mint the code.
 */
export const issueAuthzRequest = async (
  req: AuthzRequest,
): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  return await sign(AUTHZ_REQ_TYP, {
    iss: idpOrigin,
    client_id: req.clientId,
    redirect_uri: req.redirectUri,
    code_challenge: req.codeChallenge,
    resource: req.resource,
    scope: req.scope,
    state: req.state,
    iat: now,
    exp: now + AUTHZ_REQ_TTL_S,
  });
};

const buildRedirect = (
  redirectUri: string,
  params: Record<string, string | undefined>,
): string => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
};

export interface CompleteAuthorizationInput {
  requestToken: string;
  userId: string;
  decision: "approve" | "deny";
}

/**
 * Finish an authorization: verify the signed request, then build the redirect
 * back to the client — with a fresh authorization `code` on approval, or an
 * `access_denied` error otherwise. `state` is echoed back either way.
 */
export const completeAuthorization = async (
  input: CompleteAuthorizationInput,
): Promise<{ redirect: string }> => {
  let req: JWTPayload;
  try {
    req = await verify(input.requestToken, AUTHZ_REQ_TYP);
  } catch {
    throw new OAuthError(
      "invalid_request",
      400,
      "invalid authorization request",
    );
  }

  const redirectUri = String(req.redirect_uri);
  const state = typeof req.state === "string" ? req.state : undefined;

  if (input.decision !== "approve") {
    return {
      redirect: buildRedirect(redirectUri, { error: "access_denied", state }),
    };
  }

  const code = await issueAuthCode({
    sub: input.userId,
    clientId: String(req.client_id),
    redirectUri,
    codeChallenge: String(req.code_challenge),
    resource: String(req.resource),
    scope: String(req.scope ?? ""),
  });
  return { redirect: buildRedirect(redirectUri, { code, state }) };
};

export interface AuthCodeInput {
  sub: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
}

/** Mint a single-use authorization code (called by `/oauth/authorize`). */
export const issueAuthCode = async (input: AuthCodeInput): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  return await sign(CODE_TYP, {
    iss: idpOrigin,
    sub: input.sub,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    resource: input.resource,
    scope: input.scope,
    iat: now,
    exp: now + CODE_TTL_S,
    jti: crypto.randomUUID(),
  });
};

export interface TokenSet {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const issueTokenSet = async (
  sub: string,
  clientId: string,
  resource: string,
  scope: string,
  family: string,
): Promise<TokenSet> => {
  const now = Math.floor(Date.now() / 1000);
  const access_token = await sign(ACCESS_TYP, {
    iss: idpOrigin,
    sub,
    aud: resource, // RFC 8707 audience binding
    client_id: clientId,
    scope,
    iat: now,
    nbf: now,
    exp: now + ACCESS_TTL_S,
    jti: crypto.randomUUID(),
  });
  const refresh_token = await sign(REFRESH_TYP, {
    iss: idpOrigin,
    sub,
    client_id: clientId,
    resource,
    scope,
    fam: family,
    iat: now,
    exp: now + REFRESH_TTL_S,
    jti: crypto.randomUUID(),
  });
  return {
    access_token,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token,
    scope,
  };
};

export interface ExchangeCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

/** `grant_type=authorization_code` — verify the code + PKCE, then mint tokens. */
export const exchangeAuthCode = async (
  input: ExchangeCodeInput,
): Promise<TokenSet> => {
  if (!input.code || !input.clientId || !input.codeVerifier) {
    throw new OAuthError("invalid_request", 400, "missing parameters");
  }

  let payload: JWTPayload;
  try {
    payload = await verify(input.code, CODE_TYP);
  } catch {
    throw new OAuthError("invalid_grant", 400, "invalid or expired code");
  }

  const jti = typeof payload.jti === "string" ? payload.jti : "";
  if (!jti || !(await consumeOnce(jti, CODE_TTL_S))) {
    throw new OAuthError("invalid_grant", 400, "code already used");
  }
  if (payload.client_id !== input.clientId) {
    throw new OAuthError("invalid_grant", 400, "client mismatch");
  }
  if (payload.redirect_uri !== input.redirectUri) {
    throw new OAuthError("invalid_grant", 400, "redirect_uri mismatch");
  }
  const challenge = typeof payload.code_challenge === "string"
    ? payload.code_challenge
    : "";
  if (!(await verifyPkceS256(input.codeVerifier, challenge))) {
    throw new OAuthError("invalid_grant", 400, "PKCE verification failed");
  }

  return await issueTokenSet(
    String(payload.sub),
    input.clientId,
    String(payload.resource),
    String(payload.scope ?? ""),
    crypto.randomUUID(),
  );
};

export interface RefreshInput {
  refreshToken: string;
  clientId: string;
}

/** `grant_type=refresh_token` — rotate: verify, consume the old jti (reuse
 * detection), then mint a fresh set in the same family. */
export const refreshTokens = async (
  input: RefreshInput,
): Promise<TokenSet> => {
  if (!input.refreshToken || !input.clientId) {
    throw new OAuthError("invalid_request", 400, "missing parameters");
  }

  let payload: JWTPayload;
  try {
    payload = await verify(input.refreshToken, REFRESH_TYP);
  } catch {
    throw new OAuthError("invalid_grant", 400, "invalid or expired token");
  }

  if (payload.client_id !== input.clientId) {
    throw new OAuthError("invalid_grant", 400, "client mismatch");
  }

  const jti = typeof payload.jti === "string" ? payload.jti : "";
  const ttlLeft = typeof payload.exp === "number"
    ? Math.max(payload.exp - Math.floor(Date.now() / 1000), 1)
    : REFRESH_TTL_S;
  if (!jti || !(await consumeOnce(jti, ttlLeft))) {
    // Reuse of an already-rotated refresh token — treat as compromised.
    throw new OAuthError("invalid_grant", 400, "refresh token reuse detected");
  }

  return await issueTokenSet(
    String(payload.sub),
    input.clientId,
    String(payload.resource),
    String(payload.scope ?? ""),
    typeof payload.fam === "string" ? payload.fam : crypto.randomUUID(),
  );
};
