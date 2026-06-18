const rpID = Deno.env.get("RP_ID") ?? "localhost";
const rpName = Deno.env.get("RP_NAME") ?? "Local Development";
const idpOrigin = Deno.env.get("IDP_ORIGIN") ?? "http://localhost:3000";

const authorizeWhitelist = (Deno.env.get("AUTHORIZE_WHITELIST") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const pushContact = Deno.env.get("PUSH_CONTACT")?.trim() ||
  "mailto:o@kbn.one";

/**
 * Per-subscription send rate limit (fixed): at most `pushRateLimit`
 * notifications are delivered to a single subscription per `pushRateWindowMs`;
 * further sends in the window are throttled (skipped) so a device can't be
 * flooded.
 */
const pushRateLimit = 1;
const pushRateWindowMs = 60_000;

export {
  authorizeWhitelist,
  idpOrigin,
  pushContact,
  pushRateLimit,
  pushRateWindowMs,
  rpID,
  rpName,
};
