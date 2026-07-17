/**
 * GET /me — account dashboard.
 *
 * The page is composed here on the server from independent client islands
 * (under `client/me/`), each hydrated on its own. The server passes only
 * serializable props — notably `NICKNAME_MAX_LENGTH` to the profile island —
 * so no shared client-side constant is needed.
 */

import type { RequestHandler } from "@remix-run/fetch-router";

import {
  AccountHeader,
  DangerZone,
  NotificationsCard,
  PasskeysCard,
  ProfileCard,
} from "../../client/me/mod.ts";
import { NICKNAME_MAX_LENGTH } from "../lib/user-profile.ts";
import { renderPage } from "../utils/render.tsx";

export const meAction: RequestHandler<Record<string, never>> = (context) =>
  renderPage(
    context,
    <main class="mx-auto w-full max-w-3xl p-6 space-y-10">
      <AccountHeader />
      <section class="space-y-10">
        <ProfileCard maxLength={NICKNAME_MAX_LENGTH} />
        <PasskeysCard />
        <NotificationsCard />
        <DangerZone />
      </section>
    </main>,
  );
