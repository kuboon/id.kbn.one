/**
 * GET /docs — the reference for RP developers. Static, server-rendered.
 */

import type { RequestHandler } from "@remix-run/fetch-router";
import { idpOrigin } from "../config.ts";
import { Docs } from "../ui/docs.tsx";
import { renderPage } from "../utils/render.tsx";

export const docsAction: RequestHandler = (context) =>
  renderPage(context, <Docs idpOrigin={idpOrigin} />);
