/**
 * OAuth 2.1 authorization endpoint (interactive) for MCP clients.
 *
 *   GET  /oauth/authorize         — validate params + resolve the CIMD client,
 *                                    then render the passkey-login + consent
 *                                    page (`<OAuthAuthorize />` clientEntry).
 *   POST /oauth/authorize/approve — (DPoP + signed-in user) turn the approved
 *                                    request into an authorization code and
 *                                    return the redirect back to the client.
 */

import type { RequestContext } from "@remix-run/fetch-router";
import { type } from "arktype";

import { OAuthAuthorize } from "../../client/oauth-authorize.tsx";
import { setNoStore } from "../middleware/auth.ts";
import { User } from "../middleware/user.ts";
import { renderPage } from "../utils/render.tsx";
import {
  CimdError,
  redirectUriAllowed,
  resolveCimdClient,
} from "../lib/oauth/cimd.ts";
import { DEFAULT_SCOPE } from "../lib/oauth/metadata.ts";
import {
  completeAuthorization,
  issueAuthzRequest,
  OAuthError,
} from "../lib/oauth/tokens.ts";

const errorPage = (context: RequestContext, message: string): Response =>
  new Response(
    ...(renderErrorArgs(context, message)),
  );

// Small helper so the JSX below reads cleanly.
const renderErrorArgs = (
  context: RequestContext,
  message: string,
): [BodyInit, ResponseInit] => {
  const res = renderPage(
    context,
    <main class="mx-auto w-full max-w-md p-6">
      <div role="alert" class="alert alert-error alert-soft">
        <span>{message}</span>
      </div>
    </main>,
  );
  return [res.body!, { status: 400, headers: res.headers }];
};

const isAbsoluteUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

export const oauthAuthorizeAction = async (
  context: RequestContext,
): Promise<Response> => {
  const url = new URL(context.request.url);
  const q = url.searchParams;
  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";

  // Client + redirect_uri must be validated before we can safely redirect
  // errors back; failures here render an error page instead.
  if (!clientId) return errorPage(context, "client_id is required");
  let client;
  try {
    client = await resolveCimdClient(clientId);
  } catch (error) {
    const detail = error instanceof CimdError ? error.message : "unknown";
    return errorPage(context, `invalid client_id: ${detail}`);
  }
  if (!redirectUri || !redirectUriAllowed(client, redirectUri)) {
    return errorPage(context, "redirect_uri is not registered for this client");
  }

  // redirect_uri is trusted now — remaining errors go back to the client.
  const redirectError = (error: string, description?: string): Response => {
    const target = new URL(redirectUri);
    target.searchParams.set("error", error);
    if (description) target.searchParams.set("error_description", description);
    const state = q.get("state");
    if (state) target.searchParams.set("state", state);
    return Response.redirect(target.toString(), 302);
  };

  if (q.get("response_type") !== "code") {
    return redirectError("unsupported_response_type");
  }
  const codeChallenge = q.get("code_challenge") ?? "";
  if (!codeChallenge || q.get("code_challenge_method") !== "S256") {
    return redirectError("invalid_request", "PKCE S256 is required");
  }
  const resource = q.get("resource") ?? "";
  if (!resource || !isAbsoluteUrl(resource)) {
    return redirectError("invalid_target", "a valid resource is required");
  }
  const scope = q.get("scope")?.trim() || DEFAULT_SCOPE;

  const requestToken = await issueAuthzRequest({
    clientId,
    redirectUri,
    codeChallenge,
    resource,
    scope,
    state: q.get("state") ?? undefined,
  });

  return renderPage(
    context,
    <OAuthAuthorize
      clientName={client.clientName ?? new URL(clientId).host}
      resource={resource}
      scope={scope}
      requestToken={requestToken}
      redirectOrigin={new URL(redirectUri).origin}
    />,
  );
};

const approveBody = type({
  request_token: "string>0",
  decision: '"approve" | "deny"',
});

export const oauthApproveAction = async (
  context: RequestContext,
): Promise<Response> => {
  const { id: userId } = context.get(User);
  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return Response.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const body = approveBody(raw);
  if (body instanceof type.errors) {
    return Response.json({ message: body.summary }, { status: 400 });
  }
  try {
    const result = await completeAuthorization({
      requestToken: body.request_token,
      userId,
      decision: body.decision,
    });
    return setNoStore(Response.json(result));
  } catch (error) {
    if (error instanceof OAuthError) {
      return Response.json({ message: error.description ?? error.error }, {
        status: error.status,
      });
    }
    throw error;
  }
};
