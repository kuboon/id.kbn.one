/**
 * GET / — sign-in landing page (passkey).
 */

import type { BuildAction } from "@remix-run/fetch-router";
import { Index } from "../../client/index.tsx";
import { routes } from "../routes.ts";
import { renderPage } from "../utils/render.tsx";

export const homeAction: BuildAction<"GET", typeof routes.home> = (context) => {
  return renderPage(context, <Index setup={null} />);
};
