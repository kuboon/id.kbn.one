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
 * Where feedback from RP users is reported: the owner's home portal MCP
 * endpoint. Left unset (local dev, tests), reports are stored in D1 only.
 */
const feedbackMcpUrl = readEnv("FEEDBACK_MCP_URL")?.trim();
const feedbackMcpToken = readEnv("FEEDBACK_MCP_TOKEN")?.trim();
const feedbackMcpHomeId = readEnv("FEEDBACK_MCP_HOME_ID")?.trim();
const feedbackHomePortal = feedbackMcpUrl && feedbackMcpToken &&
    feedbackMcpHomeId
  ? { url: feedbackMcpUrl, token: feedbackMcpToken, homeId: feedbackMcpHomeId }
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
