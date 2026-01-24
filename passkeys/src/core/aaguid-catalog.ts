import { aaguidMap } from "./aaguid-data.ts";

const normaliseAaguid = (value: string) => value.trim().toLowerCase();

export const findAaguidName = (aaguid: string | null) => {
  if (!aaguid) return null;
  const key = normaliseAaguid(aaguid);
  return aaguidMap.get(key)?.name ?? null;
};
