/**
 * GET /me — account dashboard. Hands off to the `<Me />` clientEntry,
 * which renders a loading shell on the server and the full account view
 * on the client after fetching credentials and push subscriptions.
 */

import type { RequestHandler } from "@remix-run/fetch-router";
import { Me } from "../../client/me.tsx";
import { renderPage } from "../utils/render.tsx";

export const meAction: RequestHandler = (context) =>
  renderPage(context, <Me setup={null} />);
