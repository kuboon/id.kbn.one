export class DenoKvJtiStore {
  constructor(private kv: Deno.Kv) {}

  /**
   * Checks if a JTI has been used before and marks it as used.
   * Returns true if it's new (not used), false if it's a replay.
   * Uses an atomic transaction to prevent race conditions.
   */
  async checkReplay(jti: string): Promise<boolean> {
    const key = ["dpop_jti", jti];
    const res = await this.kv.atomic()
      .check({ key, versionstamp: null })
      .set(key, true, { expireIn: 1000 * 60 * 10 })
      .commit();
    return res.ok;
  }
}
