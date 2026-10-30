import { assert, assertEquals } from "@std/assert";

import router from "../router.ts";
import { idpOrigin } from "../config.ts";

const getDocs = async (headers?: HeadersInit) => {
  const res = await router.fetch(
    new Request("http://localhost/docs", { headers }),
  );
  return { status: res.status, html: await res.text() };
};

Deno.test("GET /docs renders the RP reference inside the shell", async () => {
  const { status, html } = await getDocs();
  assertEquals(status, 200);
  assert(html.includes("<html"));
  assert(html.includes("RP 開発者向けドキュメント"));
});

Deno.test("docs: examples name this IdP's own origin", async () => {
  const { html } = await getDocs({ "rmx-frame": "1" });
  assert(!html.includes("<html"), "a frame request gets the fragment only");
  assert(html.includes(`${idpOrigin}/rp.js`));
  assert(html.includes(`${idpOrigin}/.well-known/jwks.json`));
});
