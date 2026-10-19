/**
 * Serialisation shared by the KV export and the D1 import.
 *
 * Deno KV stores structured-clone values, which JSON cannot represent on its
 * own, and key parts carry a type (`1` and `"1"` are different keys). Both are
 * written with an explicit type tag so the migration round-trips exactly
 * instead of quietly coercing — and anything outside the supported set throws,
 * naming the key, rather than being dropped.
 *
 * @module
 */

export type TaggedPart =
  | { t: "s"; v: string }
  | { t: "n"; v: number }
  | { t: "b"; v: boolean }
  | { t: "B"; v: string }
  | { t: "u8"; v: string };

/** One exported entry. `expiresAt` is epoch ms, absent when there is no TTL. */
export interface ExportedEntry {
  key: TaggedPart[];
  value: unknown;
  expiresAt?: number;
}

const toBase64 = (bytes: Uint8Array): string =>
  bytes.toBase64({ alphabet: "base64url", omitPadding: true });
const fromBase64 = (s: string): Uint8Array =>
  Uint8Array.fromBase64(s, { alphabet: "base64url" });

export const encodeKeyParts = (key: readonly unknown[]): TaggedPart[] =>
  key.map((part): TaggedPart => {
    if (typeof part === "string") return { t: "s", v: part };
    if (typeof part === "number") return { t: "n", v: part };
    if (typeof part === "boolean") return { t: "b", v: part };
    if (typeof part === "bigint") return { t: "B", v: part.toString() };
    if (part instanceof Uint8Array) return { t: "u8", v: toBase64(part) };
    throw new TypeError(
      `Unsupported key part of type ${typeof part}: ${String(part)}`,
    );
  });

export const decodeKeyParts = (
  parts: readonly TaggedPart[],
): (string | number | bigint | boolean | Uint8Array)[] =>
  parts.map((p) => {
    switch (p.t) {
      case "s":
        return p.v;
      case "n":
        return p.v;
      case "b":
        return p.v;
      case "B":
        return BigInt(p.v);
      case "u8":
        return fromBase64(p.v);
    }
  });

/** Marker wrapping a value type JSON has no representation for. */
const TAG = "$kvmig";

/**
 * Convert a structured-clone value into JSON-safe form, tagging the types
 * that need it. Throws on a type this migration has not been taught, so an
 * unexpected value fails the export instead of arriving corrupted.
 */
export const encodeValue = (value: unknown, path = "$"): unknown => {
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}`);
    }
    return value;
  }
  if (typeof value === "bigint") {
    return { [TAG]: "bigint", v: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return { [TAG]: "u8", v: toBase64(value) };
  }
  if (value instanceof Date) {
    return { [TAG]: "date", v: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => encodeValue(v, `${path}[${i}]`));
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(
        `Unsupported object at ${path}: ${
          proto?.constructor?.name ?? "unknown"
        }`,
      );
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === TAG) throw new TypeError(`Reserved key "${TAG}" at ${path}`);
      out[k] = encodeValue(v, `${path}.${k}`);
    }
    return out;
  }
  throw new TypeError(`Unsupported value of type ${typeof value} at ${path}`);
};

export const decodeValue = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  const tag = (value as Record<string, unknown>)[TAG];
  if (typeof tag === "string") {
    const v = (value as { v: string }).v;
    if (tag === "bigint") return BigInt(v);
    if (tag === "u8") return fromBase64(v);
    if (tag === "date") return new Date(v);
    throw new TypeError(`Unknown tag ${tag}`);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = decodeValue(v);
  }
  return out;
};

/**
 * Key prefixes that hold short-lived state and are deliberately not carried
 * across: sessions make users sign in again, the rest regenerate. Replay and
 * single-use markers must NOT be imported — a stale marker would reject a
 * fresh token, and an expired one protects nothing.
 */
export const EPHEMERAL_PREFIXES: readonly string[] = [
  "dpop-session",
  "dpop_jti",
  "oauth",
  "push:ratelimit",
];

/** True when an exported key belongs to a prefix we intentionally drop. */
export const isEphemeral = (key: readonly TaggedPart[]): boolean => {
  const head = key[0]?.t === "s" ? String(key[0].v) : "";
  const second = key[1]?.t === "s" ? String(key[1].v) : "";
  return EPHEMERAL_PREFIXES.includes(head) ||
    EPHEMERAL_PREFIXES.includes(`${head}:${second}`);
};
