/**
 * GET /authorize — entry point that dispatches between two flows:
 *
 *  1. Simple DPoP flow (first-party RPs): `?dpop_jkt=...&redirect_uri=...`.
 *     Validated here, handed off to `<Authorize mode="dpop" />`. The RP
 *     later fetches `/session` with its DPoP key for a bound JWS.
 *  2. OIDC Authorization Code flow (third-party RPs): delegated to
 *     `oidcAuthorizeAction` in `lib/oidc/controller/authorize.tsx` when
 *     the query looks OIDC-shaped.
 */

import type { RequestHandler } from "@remix-run/fetch-router";
import { Authorize } from "../../client/authorize.tsx";
import { authorizeWhitelist } from "../config.ts";
import {
  isOidcAuthorizeRequest,
  oidcAuthorizeAction,
} from "../lib/oidc/controller/authorize.tsx";
import { renderPage } from "../utils/render.tsx";

const jktPattern = /^[A-Za-z0-9_-]{43}$/;

const isAllowedDpopRedirectUri = (redirectUri: string): boolean => {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  return authorizeWhitelist.some((x) =>
    url.hostname === x || url.hostname.endsWith("." + x)
  );
};

export const authorizeAction: RequestHandler<
  Record<string, never>
> = (context) => {
  const url = new URL(context.request.url);
  const params = url.searchParams;

  if (isOidcAuthorizeRequest(params)) {
    return oidcAuthorizeAction(context);
  }

  const dpopJkt = params.get("dpop_jkt") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!dpopJkt || !jktPattern.test(dpopJkt)) {
    return Response.json({ message: "Invalid dpop_jkt" }, { status: 400 });
  }
  if (!redirectUri || !isAllowedDpopRedirectUri(redirectUri)) {
    return Response.json({
      message: "redirect_uri is missing or not allowed",
    }, { status: 400 });
  }

  let rpOrigin = "";
  try {
    rpOrigin = new URL(redirectUri).origin;
  } catch { /* validated above */ }

  return renderPage(
    context,
    <Authorize
      mode="dpop"
      dpopJkt={dpopJkt}
      redirectUri={redirectUri}
      rpOrigin={rpOrigin}
    />,
  );
};
