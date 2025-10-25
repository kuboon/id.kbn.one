let kvPromise: Promise<Deno.Kv> | undefined;
export const getKvInstance = (): Promise<Deno.Kv> => {
  if (!kvPromise) {
    kvPromise = Deno.openKv();
  }
  return kvPromise;
};
export const test = {
    overwrideKvPromise: (kvP: Promise<Deno.Kv>) => {
        kvPromise = kvP;
    }
}
