/**
 * Shared user-profile constants. Browser-safe (no runtime deps) so both the
 * client (`me.tsx`) and the server validation (`server/lib/user-profile.ts`)
 * import the same source of truth.
 */

/** Maximum length of a user's display nickname. */
export const NICKNAME_MAX_LENGTH = 64;
