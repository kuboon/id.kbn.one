/**
 * Hostname-based allow-list shared by every place that consults
 * `AUTHORIZE_WHITELIST`: `/authorize` redirect_uri validation, CORS, and
 * `/rp/notifications` client authentication.
 *
 * Each entry is normalized to a hostname (a bare host like `kbn.one` or a full
 * origin like `https://kbn.one` both work). An origin is allowed when its
 * hostname equals an entry **or is a subdomain of it** — so whitelisting
 * `kbn.one` also allows `app.kbn.one`, `a.b.kbn.one`, etc. Scheme and port are
 * ignored (matching the existing redirect_uri behaviour).
 *
 * Pure module (no config import) so it stays easy to unit-test.
 */

/** Normalize a whitelist entry to a bare hostname, or undefined if unusable. */
const toHost = (entry: string): string | undefined => {
  const trimmed = entry.trim();
  if (!trimmed) return undefined;
  const withScheme = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname || undefined;
  } catch {
    return undefined;
  }
};

/** True when `hostname` equals `host` or is a dot-delimited subdomain of it. */
export const hostnameMatches = (hostname: string, host: string): boolean =>
  hostname === host || hostname.endsWith("." + host);

export interface OriginAllowlist {
  /** Whether a bare hostname is allowed. */
  hostAllowed(hostname: string): boolean;
  /** Whether an origin/URL string's hostname is allowed. */
  originAllowed(origin: string): boolean;
}

/** Build an allow-list from `AUTHORIZE_WHITELIST`-style entries. */
export const buildOriginAllowlist = (entries: string[]): OriginAllowlist => {
  const hosts = entries
    .map(toHost)
    .filter((h): h is string => h !== undefined);

  const hostAllowed = (hostname: string): boolean =>
    hosts.some((h) => hostnameMatches(hostname, h));

  const originAllowed = (origin: string): boolean => {
    try {
      return hostAllowed(new URL(origin).hostname);
    } catch {
      return false;
    }
  };

  return { hostAllowed, originAllowed };
};
