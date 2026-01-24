// Data derived from https://github.com/passkeydeveloper/passkey-authenticator-aaguids
// The full catalog could not be fetched in this environment, so this subset
// includes commonly used authenticators.

import AAGUID_CATALOG from "./aaguid.json" with { type: "json" };

interface AaguidCatalogEntry {
  name: string;
  icon_light?: string;
  icon_dark?: string;
}

export const aaguidMap = new Map<string, AaguidCatalogEntry>(
  Object.entries(AAGUID_CATALOG),
);
