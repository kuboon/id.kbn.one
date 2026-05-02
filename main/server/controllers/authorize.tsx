/**
 * GET /authorize?dpop_jkt=...&redirect_uri=...
 *
 * Validates the query parameters server-side, then hands off to the
 * `<Authorize />` clientEntry which drives the IdP probe + passkey +
 * bind + redirect flow with the validated values passed as props.
 */

import type { RequestHandler } from "@remix-run/fetch-router";
import { Authorize } from "../../client/authorize.tsx";
import { authorizeWhitelist } from "../config.ts";
import { renderPage } from "../utils/render.tsx";

const jktPattern = /^[A-Za-z0-9_-]{43}$/;

const isAllowedRedirectUri = (redirectUri: string): boolean => {
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
  const dpopJkt = url.searchParams.get("dpop_jkt") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  if (!dpopJkt || !jktPattern.test(dpopJkt)) {
    return Response.json({ message: "Invalid dpop_jkt" }, { status: 400 });
  }
  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
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
      dpopJkt={dpopJkt}
      redirectUri={redirectUri}
      rpOrigin={rpOrigin}
    />,
  );
};
