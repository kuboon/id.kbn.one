// Data derived from https://github.com/passkeydeveloper/passkey-authenticator-aaguids
// The full catalog could not be fetched in this environment, so this subset
// includes commonly used authenticators.

export interface AaguidCatalogEntry {
  aaguid: string;
  name: string;
  description?: string;
  icon_light?: string;
  icon_dark?: string;
  url?: string;
}

export const AAGUID_CATALOG: readonly AaguidCatalogEntry[] = [
  {
    aaguid: "adce0002-35bc-c60a-648b-0b25f1f05503",
    name: "Windows Hello",
    description: "Windows Hello platform authenticator",
    url: "https://learn.microsoft.com/windows/security/identity-protection/windows-hello-for-business/"
  },
  {
    aaguid: "ee882879-721c-4913-9775-3dfcce97072a",
    name: "Android パスキー",
    description: "Google Password Manager / Android passkey platform authenticator",
    url: "https://developers.google.com/identity/passkeys"
  },
  {
    aaguid: "2fc0579f-8113-47ea-b116-bb5a8db9202a",
    name: "YubiKey 5 Series",
    description: "YubiKey 5 security keys",
    url: "https://www.yubico.com/"
  }
];
