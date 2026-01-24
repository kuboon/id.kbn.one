import type { PasskeyCredential, PasskeyRepository } from "./types.ts";

export class InMemoryPasskeyRepository implements PasskeyRepository {
  private readonly credentials = new Map<string, PasskeyCredential>();

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

  addCredential(credential: PasskeyCredential): Promise<void> {
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

  deleteCredentialsByUserId(userId: string): Promise<void> {
    for (const [id, credential] of this.credentials.entries()) {
      if (credential.userId === userId) {
        this.credentials.delete(id);
      }
    }
    return Promise.resolve();
  }
}
