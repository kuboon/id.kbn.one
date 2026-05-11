/**
 * GET /authorize (OIDC branch).
 *
 * Called by the top-level `authorizeAction` when the query looks like an
 * OIDC request (`isOidcAuthorizeRequest`). Validates the params and
 * renders the `<Authorize mode="oidc" />` clientEntry. The simple DPoP
 * flow lives in `main/server/controllers/authorize.tsx`.
 */

import type { RequestContext } from "@remix-run/fetch-router";

import { Authorize } from "../../../../client/authorize.tsx";
import { renderPage } from "#server/utils/render.tsx";
import { isOidcAuthorizeRequest, parseOidcAuthorizeParams } from "../params.ts";

export { isOidcAuthorizeRequest };

export const oidcAuthorizeAction = (context: RequestContext): Response => {
  const url = new URL(context.request.url);
  const parsed = parseOidcAuthorizeParams(url.searchParams);
  if ("error" in parsed) {
    return Response.json(parsed, { status: 400 });
  }
  return renderPage(
    context,
    <Authorize
      mode="oidc"
      rpOrigin={parsed.client_id}
      oidcClientId={parsed.client_id}
      oidcRedirectUri={parsed.redirect_uri}
      oidcScope={parsed.scope}
      oidcState={parsed.state}
      oidcNonce={parsed.nonce ?? ""}
      oidcCodeChallenge={parsed.code_challenge}
    />,
  );
};
