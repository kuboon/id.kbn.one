import { readEnv } from "#env";

import { buildOriginAllowlist } from "./lib/origin-allowlist.ts";

const rpID = readEnv("RP_ID") ?? "localhost";
const rpName = readEnv("RP_NAME") ?? "Local Development";
const idpOrigin = readEnv("IDP_ORIGIN") ?? "http://localhost:3000";

const authorizeWhitelist = (readEnv("AUTHORIZE_WHITELIST") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

/**
 * Shared hostname allow-list derived from `AUTHORIZE_WHITELIST`. Allows each
 * whitelisted host and all of its subdomains. Consulted by `/authorize`, CORS,
 * and `/rp/notifications`.
 */
const originAllowlist = buildOriginAllowlist(authorizeWhitelist);

const pushContact = readEnv("PUSH_CONTACT")?.trim() ||
  "mailto:o@kbn.one";

/**
 * Where feedback from RP users is reported: the owner's home portal, through
 * its agent's MCP endpoint, in this home. Only the token is configuration,
 * and a secret; without it (local dev, tests) reports are stored in D1 only.
 */
const HOME_PORTAL_MCP_URL =
  "https://home.kbn.one/mcp/agent_01M5HEQYHRY26KB5NPFV89XNZE";
const FEEDBACK_HOME_ID = "01KVH9GZCEQZVGH7T8NGEV0JE4";
const homePortalToken = readEnv("HOME_PORTAL_MCP_TOKEN")?.trim();
const feedbackHomePortal = homePortalToken
  ? {
    url: HOME_PORTAL_MCP_URL,
    token: homePortalToken,
    homeId: FEEDBACK_HOME_ID,
  }
  : undefined;

export {
  authorizeWhitelist,
  feedbackHomePortal,
  idpOrigin,
  originAllowlist,
  pushContact,
  rpID,
  rpName,
};
