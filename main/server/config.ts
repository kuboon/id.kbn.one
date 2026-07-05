import { buildOriginAllowlist } from "./lib/origin-allowlist.ts";

const rpID = Deno.env.get("RP_ID") ?? "localhost";
const rpName = Deno.env.get("RP_NAME") ?? "Local Development";
const idpOrigin = Deno.env.get("IDP_ORIGIN") ?? "http://localhost:3000";

const authorizeWhitelist = (Deno.env.get("AUTHORIZE_WHITELIST") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

/**
 * Shared hostname allow-list derived from `AUTHORIZE_WHITELIST`. Allows each
 * whitelisted host and all of its subdomains. Consulted by `/authorize`, CORS,
 * and `/rp/notifications`.
 */
const originAllowlist = buildOriginAllowlist(authorizeWhitelist);

const pushContact = Deno.env.get("PUSH_CONTACT")?.trim() ||
  "mailto:o@kbn.one";

export {
  authorizeWhitelist,
  idpOrigin,
  originAllowlist,
  pushContact,
  rpID,
  rpName,
};
