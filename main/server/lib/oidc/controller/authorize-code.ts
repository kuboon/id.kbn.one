/**
 * POST /authorize/code — final step of the OIDC code flow on the IdP side.
 *
 * Runs in the `userApi:` layer, so the caller is a DPoP-bound, signed-in
 * user. The body re-supplies the OIDC `/authorize` parameters (the
 * `<Authorize mode="oidc" />` component just echoes what the server gave
 * it). We re-validate them server-side against the whitelist before
 * issuing a short-lived authorization code, then return the URL the
 * client should redirect to.
 */

import type { RequestContext } from "@remix-run/fetch-router";

import { setNoStore } from "#server/middleware/auth.ts";
import { User } from "#server/middleware/user.ts";
import { issueAuthorizationCode } from "../code-store.ts";
import { parseOidcAuthorizeParams } from "../params.ts";

export const authorizeCodeAction = async (
  context: RequestContext,
): Promise<Response> => {
  const { id: userId } = context.get(User);
  let raw: Record<string, string>;
  try {
    raw = await context.request.json() as Record<string, string>;
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const parsed = parseOidcAuthorizeParams({ ...raw, response_type: "code" });
  if ("error" in parsed) {
    return Response.json(parsed, { status: 400 });
  }
  const code = await issueAuthorizationCode({
    client_id: parsed.client_id,
    redirect_uri: parsed.redirect_uri,
    scope: parsed.scope,
    nonce: parsed.nonce,
    user_id: userId,
    auth_time: Math.floor(Date.now() / 1000),
    code_challenge: parsed.code_challenge,
    code_challenge_method: "S256",
  });
  const redirectUrl = new URL(parsed.redirect_uri);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", parsed.state);
  return setNoStore(Response.json({ redirect_to: redirectUrl.toString() }));
};
