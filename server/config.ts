const rpID = Deno.env.get("RP_ID") ?? "id.kbn.one";
const rpName = Deno.env.get("RP_NAME") ?? "id.kbn.one";

const relatedOrigins = (Deno.env.get("ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)
  .map((origin) =>
    origin.includes("://") || origin.startsWith("localhost:")
      ? origin
      : `https://${origin}`
  );

export { relatedOrigins, rpID, rpName };
