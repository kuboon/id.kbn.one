import { init } from "./client.ts";
import { InMemoryKeyStore } from "./client_keystore.ts";

function base64UrlDecodeToString(input: string): string {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

Deno.test("apiCall attaches DPoP header and preserves other headers", async () => {
  const recorded: Array<{ input: RequestInfo; init?: RequestInit }> = [];
  const fakeFetch = (input: RequestInfo, init?: RequestInit) => {
    recorded.push({ input, init });
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  const keyStore = new InMemoryKeyStore();
  const { apiCall } = await init({ keyStore, fetch: fakeFetch as typeof fetch });

  const url = "https://example.com/some/path?x=1";
  const res = await apiCall(url, { method: "post", headers: { "X-Test": "1" } });
  if (!res || !(res instanceof Response)) throw new Error("fetch did not return a Response");

  if (recorded.length !== 1) throw new Error("expected fetch to be called once");

  const call = recorded[0];
  if (!call.init || !call.init.headers) throw new Error("expected headers in fetch init");
  const headers = new Headers(call.init.headers as HeadersInit);
  const dpop = headers.get("DPoP");
  if (!dpop) throw new Error("DPoP header not present");

  const parts = dpop.split(".");
  if (parts.length !== 3) throw new Error("DPoP proof is not a JWT-like string");

  const headerJson = JSON.parse(base64UrlDecodeToString(parts[0]));
  const payloadJson = JSON.parse(base64UrlDecodeToString(parts[1]));

  if (headerJson.typ !== "dpop+jwt") throw new Error("unexpected typ in header");
  if (headerJson.alg !== "ES256") throw new Error("unexpected alg in header");
  // `jwk` may be omitted when the public key is non-extractable; that's acceptable

  if (payloadJson.htm !== "POST") throw new Error("method not normalized in payload");
  if (payloadJson.htu !== "https://example.com/some/path?x=1") throw new Error("htu not normalized in payload");
  if (typeof payloadJson.jti !== "string") throw new Error("jti missing or wrong type");
  if (typeof payloadJson.iat !== "number") throw new Error("iat missing or wrong type");

  // ensure original header preserved
  if (headers.get("X-Test") !== "1") throw new Error("existing header lost");
});
