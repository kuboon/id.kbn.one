/**
 * GET / — sign-in landing page (passkey).
 */

import type { RequestHandler } from "@remix-run/fetch-router";
import { Index } from "../../client/index.tsx";
import { renderPage } from "../utils/render.tsx";

export const homeAction: RequestHandler = (context) =>
  renderPage(context, <Index setup={null} />);
