import { findAaguidName } from "./aaguid-catalog.ts";
import type { PasskeyCredential } from "./types.ts";

const usesRoamingTransport = (transports?: readonly string[]) => {
  if (!Array.isArray(transports)) {
    return false;
  }
  return transports.some((transport) => {
    const value = typeof transport === "string" ? transport.toLowerCase() : "";
    return value === "usb" || value === "nfc" || value === "ble";
  });
};

const describeAuthenticator = (
  deviceType: string | undefined,
  backedUp: boolean | undefined,
  transports?: readonly string[],
) => {
  if (usesRoamingTransport(transports)) {
    return "セキュリティキー";
  }
  if (
    Array.isArray(transports) &&
    transports.some((value) => value === "internal")
  ) {
    if (deviceType === "multiDevice") {
      return backedUp ? "同期済みパスキー" : "マルチデバイスパスキー";
    }
    return "このデバイスのパスキー";
  }
  if (deviceType === "multiDevice") {
    return backedUp ? "同期済みパスキー" : "マルチデバイスパスキー";
  }
  if (deviceType === "singleDevice") {
    return "このデバイスのパスキー";
  }
  return backedUp ? "同期済みパスキー" : "パスキー";
};

const guessNicknameFromUserAgent = (userAgent: string | undefined) => {
  if (!userAgent) {
    return null;
  }
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    return "このiOSデバイスのパスキー";
  }
  if (ua.includes("mac os x") || ua.includes("macintosh")) {
    return "このMacのパスキー";
  }
  if (ua.includes("android")) {
    if (ua.includes("pixel")) {
      return "このPixelのパスキー";
    }
    return "Android デバイスのパスキー";
  }
  if (ua.includes("windows")) {
    return "Windows デバイスのパスキー";
  }
  if (ua.includes("linux")) {
    return "Linux デバイスのパスキー";
  }
  return null;
};

const ensureUniqueNickname = (
  base: string,
  existingCredentials: PasskeyCredential[],
) => {
  const trimmed = base.trim() || "パスキー";
  const used = new Set(
    existingCredentials
      .map((credential) => credential.nickname?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  if (!used.has(trimmed.toLowerCase())) {
    return trimmed;
  }
  let index = 2;
  while (used.has(`${trimmed} (${index})`.toLowerCase())) {
    index += 1;
  }
  return `${trimmed} (${index})`;
};

export type GenerateCredentialNicknameOptions = {
  aaguid: string | null;
  deviceType: string;
  backedUp: boolean;
  transports: readonly string[] | undefined;
  existingCredentials: PasskeyCredential[];
  userAgent: string | undefined;
};

export const generateCredentialNickname = (
  options: GenerateCredentialNicknameOptions,
) => {
  const datasetName = findAaguidName(options.aaguid);
  const userAgentName = guessNicknameFromUserAgent(options.userAgent);
  const fallback = describeAuthenticator(
    options.deviceType,
    options.backedUp,
    options.transports,
  );
  const base = datasetName ?? userAgentName ?? fallback ?? "パスキー";
  return ensureUniqueNickname(base, options.existingCredentials);
};
