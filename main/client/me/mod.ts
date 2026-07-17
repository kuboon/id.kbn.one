/**
 * `/me` island barrel — the single client bundle entrypoint for the account
 * page. Every island's `clientEntry` id points at this module (`/me/mod.js`),
 * so they share one bundle (and one DPoP bootstrap via `./util.ts`) while each
 * hydrates independently. The page layout that composes them lives in the
 * server controller (`server/controllers/me.tsx`).
 */

export { AccountHeader } from "./account-header.tsx";
export { ProfileCard } from "./profile-card.tsx";
export { PasskeysCard } from "./passkeys-card.tsx";
export { NotificationsCard } from "./notifications-card.tsx";
export { DangerZone } from "./danger-zone.tsx";
