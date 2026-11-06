import { assertEquals } from "@std/assert";

import router from "./router.ts";
import { idpOrigin } from "./config.ts";

// The IdP's own origin is always allowed, whatever AUTHORIZE_WHITELIST says.
const origin = idpOrigin;

Deno.test("CORS: a 401 from the signed-in layer still carries CORS headers", async () => {
  // No DPoP proof and no user: `requireUser` throws. Without CORS headers on
  // that 401 the browser hides it, and an RP's `getSession()` sees a network
  // error instead of "not signed in".
  const res = await router.fetch(
    new Request("http://localhost/session", { headers: { origin } }),
  );
  assertEquals(res.status, 401);
  assertEquals(res.headers.get("access-control-allow-origin"), origin);
  assertEquals(res.headers.get("access-control-allow-credentials"), "true");
  await res.body?.cancel();
});

Deno.test("CORS: a disallowed origin gets no CORS headers on that 401", async () => {
  const res = await router.fetch(
    new Request("http://localhost/session", {
      headers: { origin: "https://evil.example" },
    }),
  );
  assertEquals(res.headers.get("access-control-allow-origin"), null);
  await res.body?.cancel();
});
