/**
 * User profile store — a small per-user record keyed by userId, kept separate
 * from passkey credentials. Currently holds only an editable display nickname
 * (the userId itself is immutable and lives on the DPoP session).
 */

import { DenoKvRepo } from "@kbn/kv/denoKv.ts";

/**
 * Maximum length of a user's display nickname. Declared here (server side) and
 * handed to the profile island as a serializable prop, so the browser needs no
 * copy of the constant.
 */
export const NICKNAME_MAX_LENGTH = 64;

export interface UserProfile {
  /** User-chosen display name. Trimmed, non-empty, at most 64 chars. */
  nickname: string;
}

const userProfileRepo = new DenoKvRepo<UserProfile>(["user", "profile"]);

export const getUserProfile = (
  userId: string,
): Promise<UserProfile | null> => userProfileRepo.entry(userId).get();

export const setUserNickname = async (
  userId: string,
  nickname: string,
): Promise<UserProfile> => {
  const profile: UserProfile = { nickname };
  const result = await userProfileRepo.entry(userId).update(() => profile);
  if (!result.ok) throw new Error("Unable to update profile");
  return profile;
};
