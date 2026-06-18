const rpID = Deno.env.get("RP_ID") ?? "localhost";
const rpName = Deno.env.get("RP_NAME") ?? "Local Development";
const idpOrigin = Deno.env.get("IDP_ORIGIN") ?? "http://localhost:3000";

const authorizeWhitelist = (Deno.env.get("AUTHORIZE_WHITELIST") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const pushContact = Deno.env.get("PUSH_CONTACT")?.trim() ||
  "mailto:o@kbn.one";

const positiveIntEnv = (name: string, fallback: number): number => {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/**
 * Per-subscription send rate limit. At most `pushRateLimit` notifications are
 * delivered to a single subscription per `pushRateWindowMs`; further sends in
 * the window are throttled (skipped) so a device can't be flooded. A limit of
 * `0` disables throttling.
 */
const pushRateLimit = positiveIntEnv("PUSH_MAX_PER_WINDOW", 1);
const pushRateWindowMs = positiveIntEnv("PUSH_RATE_WINDOW_SECONDS", 60) * 1000;

export {
  authorizeWhitelist,
  idpOrigin,
  pushContact,
  pushRateLimit,
  pushRateWindowMs,
  rpID,
  rpName,
};
