const rpID = Deno.env.get("RP_ID") ?? "localhost";
const rpName = Deno.env.get("RP_NAME") ?? "Local Development";
const idpOriginValue = Deno.env.get("IDP_ORIGIN")?.trim();
const idpOrigin = idpOriginValue && idpOriginValue.length > 0
  ? idpOriginValue
  : null;

const relatedOrigins = (Deno.env.get("ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)
  .map((origin) =>
    origin.includes("://") || origin.startsWith("localhost:")
      ? origin
      : `https://${origin}`
  );

const pushContact = Deno.env.get("PUSH_CONTACT")?.trim() ||
  "mailto:admin@localhost";

export { idpOrigin, pushContact, relatedOrigins, rpID, rpName };
