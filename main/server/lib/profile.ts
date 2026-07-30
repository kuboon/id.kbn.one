/**
 * User profile — the small amount of user-level data the IdP owns beyond the
 * identifier itself.
 *
 * Today that is just a **nickname**: the user's own display name, as opposed to
 * a `PasskeyCredential.nickname`, which labels one device ("iPhone"). RPs read
 * it from `GET /session` (and the `nickname` claim on the issued token) to
 * prefill their own per-app display-name fields instead of showing a raw
 * userId.
 *
 * The nickname is optional; `null` means "never set" and callers should fall
 * back to whatever they consider sensible (typically the userId).
 */

import { DenoKvRepo } from "@kbn/kv/denoKv.ts";

export interface UserProfile {
  /** The user's display name. Trimmed, non-empty when present. */
  nickname: string;
}

/** Max nickname length, mirroring the input's `maxlength` on /me. */
export const NICKNAME_MAX_LENGTH = 40;

const profileRepo = new DenoKvRepo<UserProfile>(["user", "profile"]);

/** The user's nickname, or `null` when unset. */
export async function getNickname(userId: string): Promise<string | null> {
  const profile = await profileRepo.entry(userId).get();
  const nickname = profile?.nickname?.trim();
  return nickname ? nickname : null;
}

/**
 * Set (or, with an empty string, clear) the user's nickname. Returns the stored
 * value — `null` once cleared.
 */
export async function setNickname(
  userId: string,
  nickname: string,
): Promise<string | null> {
  const trimmed = nickname.trim().slice(0, NICKNAME_MAX_LENGTH);
  const entry = profileRepo.entry(userId);
  if (!trimmed) {
    await entry.update(() => null);
    return null;
  }
  await entry.update(() => ({ nickname: trimmed }));
  return trimmed;
}

/** Drop the profile. Called when the account itself is deleted. */
export async function deleteProfile(userId: string): Promise<void> {
  await profileRepo.entry(userId).update(() => null);
}
