import { AAGUID_CATALOG } from "./aaguid-data.ts";

const normaliseAaguid = (value: string) => value.trim().toLowerCase();

// AAGUID_CATALOG is expected to be a Record<string, AaguidCatalogEntry>.
const aaguidMap = new Map(Object.entries(AAGUID_CATALOG));

export const findAaguidEntry = (aaguid: string | undefined | null) => {
  if (!aaguid || typeof aaguid !== "string") {
    return null;
  }
  const key = normaliseAaguid(aaguid);
  return aaguidMap.get(key) ?? null;
};

export const findAaguidName = (aaguid: string | null) => {
  const entry = findAaguidEntry(aaguid);
  if (!entry) {
    return null;
  }
  if (entry.name && entry.name.trim()) {
    return entry.name.trim();
  }
  if (entry.description && entry.description.trim()) {
    return entry.description.trim();
  }
  return null;
};
