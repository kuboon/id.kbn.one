/**
 * Passkey storage over {@link KvRepo}, so it works on Deno KV and on D1.
 *
 * A credential is stored twice: under `credential/<id>`, which is what an
 * authentication looks up, and under `user_credentials/<userId>/<id>`, which
 * is what listing a user's passkeys reads. Both hold the whole record.
 *
 * Deno KV could write the pair in one transaction; `KvRepo` cannot, because
 * D1's compare-and-set is per row. So the writes are ordered to make an
 * interrupted pair harmless, and `credential/<id>` is treated as authoritative:
 *
 *   - adding writes the credential first (that CAS is what makes a duplicate
 *     id fail), then the index, and removes the credential again if the index
 *     write does not land, so a half-registered passkey never lingers;
 *   - deleting removes the credential first, so an interrupted delete can only
 *     leave a passkey listed that no longer authenticates — never one that
 *     still authenticates after the user removed it;
 *   - updating writes the credential first; an index left with a stale signature
 *     counter is cosmetic, since the counter is checked against the credential.
 *
 * @module
 */

import type {
  PasskeyCredential,
  PasskeyRepository,
} from "@kuboon/passkeys/remix";
import type { KvRepo } from "@kbn/kv/types.ts";

import {
  credentialRepo,
  PASSKEY_SIGN_SECRET_KEY,
  passkeySignSecretRepo,
  userCredentialRepoForUser,
} from "../repositories.ts";

export interface PasskeyStores {
  credentials: KvRepo<PasskeyCredential>;
  userCredentials: (userId: string) => KvRepo<PasskeyCredential>;
  signSecret: KvRepo<string>;
}

export class KvPasskeyRepository implements PasskeyRepository {
  constructor(private readonly stores: PasskeyStores) {}

  async getCredentialById(
    credentialId: string,
  ): Promise<PasskeyCredential | null> {
    return await this.stores.credentials.entry(credentialId).get();
  }

  async getCredentialsByUserId(userId: string): Promise<PasskeyCredential[]> {
    const credentials: PasskeyCredential[] = [];
    for await (const entry of this.stores.userCredentials(userId)) {
      const value = await entry.get();
      if (value) credentials.push(value);
    }
    return credentials;
  }

  async addCredential(credential: PasskeyCredential): Promise<void> {
    const entry = this.stores.credentials.entry(credential.id);
    let existed = false;
    const created = await entry.update((current) => {
      // Returning `current` rather than the new record matters: the updater's
      // return value is what gets written, so handing back `credential` here
      // would replace an existing passkey on the way to rejecting it.
      if (current) {
        existed = true;
        return current;
      }
      return credential;
    });
    // `ok: false` means another writer inserted the same id first, which is
    // the same answer as finding one already there.
    if (existed || !created.ok) throw new Error("Credential already exists");

    const indexed = await this.indexEntry(credential).update(() => credential);
    if (!indexed.ok) {
      await entry.update(() => null);
      throw new Error("Credential already exists");
    }
  }

  async updateCredential(credential: PasskeyCredential): Promise<void> {
    const entry = this.stores.credentials.entry(credential.id);
    const existing = await entry.get();
    if (!existing) throw new Error("Credential does not exist");

    const result = await entry.update(() => credential);
    if (!result.ok) throw new Error("Unable to update credential");

    await this.indexEntry(credential).update(() => credential);
    if (existing.userId !== credential.userId) {
      await this.stores.userCredentials(existing.userId)
        .entry(credential.id)
        .update(() => null);
    }
  }

  async deleteCredential(credentialId: string): Promise<void> {
    const entry = this.stores.credentials.entry(credentialId);
    const existing = await entry.get();
    if (!existing) return;

    const result = await entry.update(() => null);
    if (!result.ok) throw new Error("Unable to delete credential");
    await this.indexEntry(existing).update(() => null);
  }

  async deleteCredentialsByUserId(userId: string): Promise<void> {
    for await (const indexed of this.stores.userCredentials(userId)) {
      const credential = await indexed.get();
      if (credential) {
        await this.stores.credentials.entry(credential.id).update(() => null);
      }
      await indexed.update(() => null);
    }
  }

  async getOrCreateSignSecret(
    gen: () => Promise<string> | string,
  ): Promise<string> {
    const entry = this.stores.signSecret.entry(PASSKEY_SIGN_SECRET_KEY);
    const existing = await entry.get();
    if (existing) return existing;

    const secret = await Promise.resolve(gen());
    await entry.update((current) => current ?? secret);
    // Re-read rather than trust our own write: when two requests generate a
    // secret at once only one is stored, and every caller must use that one or
    // challenges signed by one would fail to verify against the other.
    const stored = await entry.get();
    if (!stored) throw new Error("Unable to store the passkey sign secret");
    return stored;
  }

  private indexEntry(credential: PasskeyCredential) {
    return this.stores.userCredentials(credential.userId)
      .entry(credential.id);
  }
}

export const credentialRepository = new KvPasskeyRepository({
  credentials: credentialRepo,
  userCredentials: userCredentialRepoForUser,
  signSecret: passkeySignSecretRepo,
});
