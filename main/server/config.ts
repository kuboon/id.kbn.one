const rpID = Deno.env.get("RP_ID") ?? "localhost";
const rpName = Deno.env.get("RP_NAME") ?? "Local Development";
const idpOriginValue = Deno.env.get("IDP_ORIGIN")?.trim();
const idpOrigin = idpOriginValue || null;

const authorizeWhitelist = (Deno.env.get("AUTHORIZE_WHITELIST") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const pushContact = Deno.env.get("PUSH_CONTACT")?.trim() ||
  "mailto:o@kbn.one";

export { authorizeWhitelist, idpOrigin, pushContact, rpID, rpName };
