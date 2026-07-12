/**
 * Client ID Metadata Documents (CIMD) — resolve an OAuth client whose
 * `client_id` is an HTTPS URL, by fetching the JSON metadata document it
 * self-publishes (MCP 2025-11-25). No client registry / DCR endpoint.
 *
 * The IdP already fetches an RP's JWKS from a URL it controls
 * (`createRemoteJWKSet`); CIMD is the same pattern for client metadata.
 *
 * Validation (per the MCP spec):
 *   - `client_id` MUST be an absolute `https:` URL to a non-private host.
 *   - the fetched document's `client_id` MUST equal the URL that was fetched.
 *   - a request's `redirect_uri` MUST appear verbatim in `redirect_uris`.
 */

/** Error resolving/validating a CIMD client. */
export class CimdError extends Error {}

export interface CimdClient {
  clientId: string;
  redirectUris: string[];
  clientName?: string;
}

/** Block loopback / link-local / private ranges to limit SSRF. */
const isPrivateHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  // Bracketed IPv6 unique-local / link-local.
  if (h.startsWith("[fc") || h.startsWith("[fd") || h.startsWith("[fe80")) {
    return true;
  }
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
};

/** Parse + SSRF-check a `client_id` URL. Throws `CimdError` when unusable. */
export const validateClientIdUrl = (clientId: string): URL => {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new CimdError("client_id must be an absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new CimdError("client_id must use https");
  }
  if (isPrivateHost(url.hostname)) {
    throw new CimdError("client_id host is not allowed");
  }
  if (url.hash) {
    throw new CimdError("client_id must not contain a fragment");
  }
  return url;
};

const MAX_DOC_BYTES = 64 * 1024;

/**
 * Fetch and validate the client's metadata document. `fetchImpl` is injectable
 * for tests. Throws `CimdError` on any failure.
 */
export const resolveCimdClient = async (
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CimdClient> => {
  validateClientIdUrl(clientId);

  let response: Response;
  try {
    response = await fetchImpl(clientId, {
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new CimdError("failed to fetch client metadata");
  }
  if (!response.ok) {
    throw new CimdError(`client metadata fetch returned ${response.status}`);
  }

  const text = await response.text();
  if (text.length > MAX_DOC_BYTES) {
    throw new CimdError("client metadata document too large");
  }
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new CimdError("client metadata is not valid JSON");
  }

  if (doc.client_id !== clientId) {
    throw new CimdError("client_id in document does not match its URL");
  }
  const redirectUris = doc.redirect_uris;
  if (
    !Array.isArray(redirectUris) || redirectUris.length === 0 ||
    !redirectUris.every((u) => typeof u === "string")
  ) {
    throw new CimdError("client metadata is missing redirect_uris");
  }

  return {
    clientId,
    redirectUris: redirectUris as string[],
    clientName: typeof doc.client_name === "string"
      ? doc.client_name
      : undefined,
  };
};

/** RFC-exact match of a requested redirect_uri against the document. */
export const redirectUriAllowed = (
  client: CimdClient,
  redirectUri: string,
): boolean => client.redirectUris.includes(redirectUri);
