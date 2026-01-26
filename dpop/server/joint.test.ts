import { init } from "../client/mod.ts";
import { InMemoryKeyRepository } from "../client/client_keystore.ts";
import { verifyDpopProofFromRequest } from "./mod.ts";

Deno.test("client and server together validate DPoP proof", async () => {
  const recorded: Array<{ req: Request }> = [];

  // fake server fetch that records the Request and runs server-side verification
  const fakeFetch = async (input: RequestInfo, init?: RequestInit) => {
    const req = typeof input === "string"
      ? new Request(input, init)
      : (input as Request);
    recorded.push({ req });

    const result = await verifyDpopProofFromRequest(req, {
      checkReplay: () => true,
    });
    if (!result.valid) {
      return new Response(result.error ?? "invalid", { status: 401 });
    }
    return new Response("ok", { status: 200 });
  };

  const keyStore = new InMemoryKeyRepository();
  const { fetchDpop: apiCall } = await init({
    keyStore,
    fetch: fakeFetch as typeof fetch,
  });

  const url = "https://example.test/endpoint?x=1";
  const res = await apiCall(url, {
    method: "PUT",
    headers: { "X-Client": "1" },
  });
  if (!res || !(res instanceof Response)) {
    throw new Error("fetch did not return a Response");
  }
  if (res.status !== 200) throw new Error("server rejected DPoP proof");

  if (recorded.length !== 1) {
    throw new Error("expected server to be called once");
  }
  const req = recorded[0].req;
  // Ensure server saw the DPoP header
  const dpop = req.headers.get("DPoP");
  if (!dpop) throw new Error("server did not receive DPoP header");
});
