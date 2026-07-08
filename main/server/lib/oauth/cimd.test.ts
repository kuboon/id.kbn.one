import { assertEquals, assertRejects } from "@std/assert";

import { CimdError, redirectUriAllowed, resolveCimdClient } from "./cimd.ts";

const CLIENT_ID = "https://client.example.com/oauth/metadata.json";

const fetchReturning = (doc: unknown, status = 200): typeof fetch =>
  ((_input: string | URL | Request) =>
    Promise.resolve(
      new Response(typeof doc === "string" ? doc : JSON.stringify(doc), {
        status,
      }),
    )) as typeof fetch;

Deno.test("resolveCimdClient: valid document resolves", async () => {
  const client = await resolveCimdClient(
    CLIENT_ID,
    fetchReturning({
      client_id: CLIENT_ID,
      client_name: "Example",
      redirect_uris: ["https://client.example.com/cb"],
    }),
  );
  assertEquals(client.clientId, CLIENT_ID);
  assertEquals(client.redirectUris, ["https://client.example.com/cb"]);
  assertEquals(client.clientName, "Example");
});

Deno.test("resolveCimdClient: client_id in doc must match the URL", async () => {
  await assertRejects(
    () =>
      resolveCimdClient(
        CLIENT_ID,
        fetchReturning({
          client_id: "https://evil.example.com/x.json",
          redirect_uris: ["https://client.example.com/cb"],
        }),
      ),
    CimdError,
    "does not match",
  );
});

Deno.test("resolveCimdClient: missing redirect_uris is rejected", async () => {
  await assertRejects(
    () =>
      resolveCimdClient(CLIENT_ID, fetchReturning({ client_id: CLIENT_ID })),
    CimdError,
    "redirect_uris",
  );
});

Deno.test("resolveCimdClient: non-https client_id is rejected (before fetch)", async () => {
  await assertRejects(
    () =>
      resolveCimdClient(
        "http://client.example.com/x.json",
        fetchReturning({}),
      ),
    CimdError,
    "https",
  );
});

Deno.test("resolveCimdClient: private/loopback host is rejected (SSRF)", async () => {
  for (
    const id of [
      "https://localhost/x.json",
      "https://127.0.0.1/x.json",
      "https://10.0.0.5/x.json",
      "https://192.168.1.2/x.json",
    ]
  ) {
    await assertRejects(
      () => resolveCimdClient(id, fetchReturning({})),
      CimdError,
    );
  }
});

Deno.test("resolveCimdClient: non-2xx fetch is rejected", async () => {
  await assertRejects(
    () => resolveCimdClient(CLIENT_ID, fetchReturning({}, 404)),
    CimdError,
  );
});

Deno.test("redirectUriAllowed: verbatim match only", () => {
  const client = {
    clientId: CLIENT_ID,
    redirectUris: ["https://client.example.com/cb"],
  };
  assertEquals(
    redirectUriAllowed(client, "https://client.example.com/cb"),
    true,
  );
  assertEquals(
    redirectUriAllowed(client, "https://client.example.com/cb/"),
    false,
  );
  assertEquals(
    redirectUriAllowed(client, "https://client.example.com/other"),
    false,
  );
});
