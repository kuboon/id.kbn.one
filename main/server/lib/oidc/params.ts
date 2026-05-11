/**
 * Parse and validate OIDC authorization request parameters from the
 * `/authorize` query. Used both by the server-side render to seed the
 * client component, and by `POST /authorize/code` to re-validate before
 * issuing a code.
 */

import { authorizeWhitelist } from "../../config.ts";

export interface OidcAuthorizeParams {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string;
  nonce?: string;
  code_challenge: string;
  code_challenge_method: "S256";
}

export type OidcAuthorizeError = {
  error:
    | "invalid_request"
    | "unsupported_response_type"
    | "invalid_scope"
    | "unauthorized_client";
  error_description: string;
};

export const isOidcAuthorizeRequest = (
  params: URLSearchParams | Record<string, string>,
): boolean => {
  const get = params instanceof URLSearchParams
    ? (k: string) => params.get(k)
    : (k: string) => params[k] ?? null;
  return get("response_type") !== null || get("client_id") !== null ||
    get("scope") !== null || get("code_challenge") !== null;
};

const isAllowedRedirectUri = (
  clientId: string,
  redirectUri: string,
): boolean => {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (url.origin !== clientId) return false;
  return authorizeWhitelist.some((x) =>
    url.hostname === x || url.hostname.endsWith("." + x)
  );
};

export const parseOidcAuthorizeParams = (
  params: URLSearchParams | Record<string, string>,
): OidcAuthorizeParams | OidcAuthorizeError => {
  const get = (k: string): string => {
    const v = params instanceof URLSearchParams
      ? params.get(k)
      : (params[k] ?? null);
    return v ?? "";
  };
  const responseType = get("response_type");
  if (responseType !== "code") {
    return {
      error: "unsupported_response_type",
      error_description: "Only response_type=code is supported",
    };
  }
  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  if (!clientId || !redirectUri) {
    return {
      error: "invalid_request",
      error_description: "client_id and redirect_uri are required",
    };
  }
  if (!isAllowedRedirectUri(clientId, redirectUri)) {
    return {
      error: "unauthorized_client",
      error_description:
        "redirect_uri origin must equal client_id and be whitelisted",
    };
  }
  const scope = get("scope");
  const scopes = scope.split(/\s+/).filter(Boolean);
  if (!scopes.includes("openid")) {
    return {
      error: "invalid_scope",
      error_description: "scope must include 'openid'",
    };
  }
  const SUPPORTED_SCOPES = new Set(["openid", "profile", "email"]);
  for (const s of scopes) {
    if (!SUPPORTED_SCOPES.has(s)) {
      return {
        error: "invalid_scope",
        error_description: `scope '${s}' is not supported`,
      };
    }
  }
  const state = get("state");
  if (!state) {
    return {
      error: "invalid_request",
      error_description: "state is required",
    };
  }
  const codeChallenge = get("code_challenge");
  const codeChallengeMethod = get("code_challenge_method");
  if (!codeChallenge) {
    return {
      error: "invalid_request",
      error_description: "code_challenge is required (PKCE)",
    };
  }
  if (codeChallengeMethod !== "S256") {
    return {
      error: "invalid_request",
      error_description: "code_challenge_method must be S256",
    };
  }
  const nonce = get("nonce");
  return {
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    nonce: nonce || undefined,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  };
};
