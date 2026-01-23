import type { PasskeyCredential, PasskeyStorage } from "./types.ts";

export class InMemoryPasskeyStore implements PasskeyStorage {
  private readonly users = new Set<string>();
  private readonly credentials = new Map<string, PasskeyCredential>();

  getUserById(userId: string): Promise<boolean> {
    return Promise.resolve(this.users.has(userId));
  }

  createUser(userId: string): Promise<void> {
    this.users.add(userId);
    return Promise.resolve();
  }

  getCredentialById(credentialId: string): Promise<PasskeyCredential | null> {
    return Promise.resolve(this.credentials.get(credentialId) ?? null);
  }

  getCredentialsByUserId(userId: string): Promise<PasskeyCredential[]> {
    return Promise.resolve(
      Array.from(this.credentials.values()).filter(
        (credential) => credential.userId === userId,
      ),
    );
  }

  saveCredential(credential: PasskeyCredential): Promise<void> {
    this.credentials.set(credential.id, { ...credential });
    return Promise.resolve();
  }

  updateCredential(credential: PasskeyCredential): Promise<void> {
    if (!this.credentials.has(credential.id)) {
      throw new Error("Credential does not exist");
    }
    this.credentials.set(credential.id, { ...credential });
    return Promise.resolve();
  }

  deleteCredential(credentialId: string): Promise<void> {
    this.credentials.delete(credentialId);
    return Promise.resolve();
  }

  deleteUser(userId: string): Promise<void> {
    this.users.delete(userId);
    for (const [id, credential] of this.credentials.entries()) {
      if (credential.userId === userId) {
        this.credentials.delete(id);
      }
    }
    return Promise.resolve();
  }
}
