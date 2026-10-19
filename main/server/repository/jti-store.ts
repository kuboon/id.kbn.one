import type { KvRepo } from "@kbn/kv/types.ts";

import { dpopJtiRepo } from "../repositories.ts";

/**
 * Replay guard for one-time JWT ids (DPoP proofs, RP client assertions).
 *
 * The marker's own insert is the check: both backends only let one writer
 * create a given row, so a racing second proof loses and is rejected.
 */
export class JtiStore {
  constructor(private readonly repo: KvRepo<boolean>) {}

  /** True when `jti` is new; false when it has been seen before. */
  async checkReplay(jti: string): Promise<boolean> {
    let seen = false;
    const result = await this.repo.entry(jti).update((current) => {
      seen = current !== null;
      return true;
    });
    // A lost CAS means someone else claimed this jti first, so it is a replay
    // too. Failing closed is the only safe direction here.
    return !seen && result.ok;
  }
}

export const jtiStore = new JtiStore(dpopJtiRepo);
