/**
 * OAuth 2.1 Authorization Server endpoints for MCP clients.
 *
 * Phase 1: metadata + token endpoint. The interactive `/oauth/authorize`
 * (passkey login + consent → authorization code) lands in a follow-up; the
 * code-issuing helper it will call lives in `lib/oauth/tokens.ts`.
 */

import type { RequestContext } from "@remix-run/fetch-router";

import { setNoStore } from "../middleware/auth.ts";
import { authorizationServerMetadata } from "../lib/oauth/metadata.ts";
import {
  exchangeAuthCode,
  OAuthError,
  refreshTokens,
  type TokenSet,
} from "../lib/oauth/tokens.ts";

const oauthErrorResponse = (
  error: string,
  status: number,
  description?: string,
): Response =>
  setNoStore(
    Response.json(
      description ? { error, error_description: description } : { error },
      { status },
    ),
  );

const tokenResponse = (set: TokenSet): Response =>
  setNoStore(Response.json(set));

export const oauthController = {
  /** GET /.well-known/oauth-authorization-server (RFC 8414). */
  metadata(): Response {
    return new Response(JSON.stringify(authorizationServerMetadata()), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=3600",
        "access-control-allow-origin": "*",
      },
    });
  },

  /** POST /oauth/token — authorization_code + refresh_token grants. */
  async token(context: RequestContext): Promise<Response> {
    let form: URLSearchParams;
    try {
      form = new URLSearchParams(await context.request.text());
    } catch {
      return oauthErrorResponse("invalid_request", 400, "unreadable body");
    }

    const grantType = form.get("grant_type");
    try {
      if (grantType === "authorization_code") {
        return tokenResponse(
          await exchangeAuthCode({
            code: form.get("code") ?? "",
            clientId: form.get("client_id") ?? "",
            redirectUri: form.get("redirect_uri") ?? "",
            codeVerifier: form.get("code_verifier") ?? "",
          }),
        );
      }
      if (grantType === "refresh_token") {
        return tokenResponse(
          await refreshTokens({
            refreshToken: form.get("refresh_token") ?? "",
            clientId: form.get("client_id") ?? "",
          }),
        );
      }
      return oauthErrorResponse(
        "unsupported_grant_type",
        400,
        `unsupported grant_type: ${grantType ?? "(none)"}`,
      );
    } catch (error) {
      if (error instanceof OAuthError) {
        return oauthErrorResponse(error.error, error.status, error.description);
      }
      throw error;
    }
  },
};
