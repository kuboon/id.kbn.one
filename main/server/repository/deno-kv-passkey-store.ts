import { getKvInstance } from "../kvInstance.ts";
import type {
  PasskeyCredential,
  PasskeyRepository,
} from "@scope/passkeys/hono-middleware";

const credentialKey = (
  credentialId: string,
): Deno.KvKey => ["credential", credentialId];

const userCredentialKey = (
  userId: string,
  credentialId?: string,
): Deno.KvKey =>
  credentialId
    ? ["user_credentials", userId, credentialId]
    : ["user_credentials", userId];

const listUserCredentials = (
  kv: Deno.Kv,
  userId: string,
): Deno.KvListIterator<PasskeyCredential> =>
  kv.list<PasskeyCredential>({
    prefix: userCredentialKey(userId),
  });

export class DenoKvPasskeyRepository implements PasskeyRepository {
  constructor(private readonly kv: Deno.Kv) {}

  static async create(): Promise<DenoKvPasskeyRepository> {
    const kv = await getKvInstance();
    return new DenoKvPasskeyRepository(kv);
  }

  async getCredentialById(
    credentialId: string,
  ): Promise<PasskeyCredential | null> {
    const entry = await this.kv.get<PasskeyCredential>(
      credentialKey(credentialId),
    );
    return entry.value ?? null;
  }

  async getCredentialsByUserId(userId: string): Promise<PasskeyCredential[]> {
    const credentials: PasskeyCredential[] = [];
    for await (const entry of listUserCredentials(this.kv, userId)) {
      if (entry.value) {
        credentials.push(entry.value);
      }
    }
    return credentials;
  }

  async addCredential(credential: PasskeyCredential): Promise<void> {
    const tx = this.kv.atomic()
      .check({ key: credentialKey(credential.id), versionstamp: null })
      .check({
        key: userCredentialKey(credential.userId, credential.id),
        versionstamp: null,
      })
      .set(credentialKey(credential.id), credential)
      .set(userCredentialKey(credential.userId, credential.id), credential);
    const result = await tx.commit();
    if (!result.ok) {
      throw new Error("Credential already exists");
    }
  }

  async updateCredential(credential: PasskeyCredential): Promise<void> {
    const existing = await this.kv.get<PasskeyCredential>(
      credentialKey(credential.id),
    );
    if (!existing.value) {
      throw new Error("Credential does not exist");
    }
    const tx = this.kv.atomic()
      .check(existing)
      .set(credentialKey(credential.id), credential)
      .set(userCredentialKey(credential.userId, credential.id), credential);
    if (existing.value.userId !== credential.userId) {
      tx.delete(userCredentialKey(existing.value.userId, credential.id));
    }
    const result = await tx.commit();
    if (!result.ok) {
      throw new Error("Unable to update credential");
    }
  }

  async deleteCredential(credentialId: string): Promise<void> {
    const existing = await this.kv.get<PasskeyCredential>(
      credentialKey(credentialId),
    );
    if (!existing.value) {
      return;
    }
    const result = await this.kv.atomic()
      .check(existing)
      .delete(credentialKey(credentialId))
      .delete(userCredentialKey(existing.value.userId, credentialId))
      .commit();
    if (!result.ok) {
      throw new Error("Unable to delete credential");
    }
  }

  async deleteCredentialsByUserId(userId: string): Promise<void> {
    for await (const entry of listUserCredentials(this.kv, userId)) {
      if (!entry.value) {
        continue;
      }
      await this.kv.delete(entry.key);
      await this.kv.delete(credentialKey(entry.value.id));
    }
  }
}
