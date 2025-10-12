import { AAGUID_CATALOG, type AaguidCatalogEntry } from "./aaguid-data.ts";

const normaliseAaguid = (value: string) => value.trim().toLowerCase();

const catalogEntries: readonly AaguidCatalogEntry[] = Array.isArray(AAGUID_CATALOG)
  ? AAGUID_CATALOG
  : [];

const aaguidMap = new Map<string, AaguidCatalogEntry>();
for (const entry of catalogEntries) {
  if (!entry || typeof entry !== "object") {
    continue;
  }
  const { aaguid } = entry;
  if (typeof aaguid !== "string" || !aaguid.trim()) {
    continue;
  }
  const key = normaliseAaguid(aaguid);
  if (!aaguidMap.has(key)) {
    aaguidMap.set(key, entry);
  }
}

export const findAaguidEntry = (aaguid: string | undefined | null) => {
  if (!aaguid || typeof aaguid !== "string") {
    return null;
  }
  const key = normaliseAaguid(aaguid);
  return aaguidMap.get(key) ?? null;
};

export const findAaguidName = (aaguid: string | undefined | null) => {
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
