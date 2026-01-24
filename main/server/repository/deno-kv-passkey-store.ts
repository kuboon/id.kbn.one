import { getKvInstance } from "../kvInstance.ts";
import type {
  PasskeyCredential,
  PasskeyRepository,
} from "@scope/passkeys/hono-middleware";

const USER_KEY_PREFIX = ["user"] as const;
const CREDENTIAL_KEY_PREFIX = ["credential"] as const;
const USER_CREDENTIAL_KEY_PREFIX = ["user_credentials"] as const;

const userKey = (userId: string): Deno.KvKey =>
  [...USER_KEY_PREFIX, userId] as Deno.KvKey;

const credentialKey = (credentialId: string): Deno.KvKey =>
  [...CREDENTIAL_KEY_PREFIX, credentialId] as Deno.KvKey;

const userCredentialKey = (
  userId: string,
  credentialId: string,
): Deno.KvKey =>
  [...USER_CREDENTIAL_KEY_PREFIX, userId, credentialId] as Deno.KvKey;

const listUserCredentials = (
  kv: Deno.Kv,
  userId: string,
): Deno.KvListIterator<PasskeyCredential> =>
  kv.list<PasskeyCredential>({
    prefix: [...USER_CREDENTIAL_KEY_PREFIX, userId] as Deno.KvKey,
  });

export class DenoKvPasskeyRepository implements PasskeyRepository {
  constructor(private readonly kv: Deno.Kv) {}

  static async create(): Promise<DenoKvPasskeyRepository> {
    const kv = await getKvInstance();
    return new DenoKvPasskeyRepository(kv);
  }

  async getUserById(userId: string): Promise<boolean> {
    const entry = await this.kv.get<true>(userKey(userId));
    return entry.value === true;
  }

  async createUser(userId: string): Promise<void> {
    const result = await this.kv.atomic()
      .check({ key: userKey(userId), versionstamp: null })
      .set(userKey(userId), true)
      .commit();
    if (!result.ok) {
      throw new Error("User already exists");
    }
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

  async saveCredential(credential: PasskeyCredential): Promise<void> {
    const userEntry = await this.kv.get<true>(
      userKey(credential.userId),
    );
    if (!userEntry.value) {
      throw new Error("User does not exist");
    }
    const tx = this.kv.atomic()
      .check(userEntry)
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
    const userEntry = await this.kv.get<true>(
      userKey(credential.userId),
    );
    if (!userEntry.value) {
      throw new Error("User does not exist");
    }
    const tx = this.kv.atomic()
      .check(existing)
      .check(userEntry)
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

  async deleteUser(userId: string): Promise<void> {
    const existing = await this.kv.get<true>(userKey(userId));
    if (!existing.value) {
      return;
    }
    const result = await this.kv.atomic()
      .check(existing)
      .delete(userKey(userId))
      .commit();
    if (!result.ok) {
      throw new Error("Unable to delete user");
    }
    for await (const entry of listUserCredentials(this.kv, userId)) {
      if (!entry.value) {
        continue;
      }
      await this.kv.delete(entry.key);
      await this.kv.delete(credentialKey(entry.value.id));
    }
  }
}
