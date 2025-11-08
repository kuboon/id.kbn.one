import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { createDpopProof, generateDpopKeyPair } from "@scope/dpop";

import type { PasskeyCredential } from "./types.ts";

const DEFAULT_MOUNT_PATH = "/webauthn";
const PASSKEY_ORIGIN = "{{PASSKEY_ORIGIN}}";

const normalizeMountPath = (path: string | undefined) => {
  if (!path || path === "/") {
    return "";
  }
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
};

const hasJsonContentType = (response: Response) => {
  const contentType = response.headers.get("content-type");
  return Boolean(contentType && contentType.toLowerCase().includes("json"));
};

const getErrorMessage = (data: unknown, fallback: string) => {
  if (typeof data === "string" && data.trim()) {
    return data;
  }
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
};

class PasskeyClientError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface CreateClientOptions {
  mountPath?: string;
  fetch?: FetchLike;
  dpopKeyPair?: CryptoKeyPair;
  enableDpop?: boolean;
}

export interface RegisterParams {
  username: string;
}

export interface AuthenticateParams {
  username: string;
}

export interface DeleteParams {
  credentialId: string;
}

export interface UpdateCredentialParams {
  credentialId: string;
  nickname: string;
}

export interface RegisterResult {
  verified: boolean;
  credential: PasskeyCredential;
}

export interface AuthenticateResult {
  verified: boolean;
  credential: PasskeyCredential;
}

const buildUrl = (mountPath: string, endpoint: string) => {
  const path = `${mountPath}${endpoint}`;
  if (!PASSKEY_ORIGIN) return path;
  return new URL(path, PASSKEY_ORIGIN).toString();
};

const fetchJson = async <T = unknown>(
  fetchImpl: FetchLike,
  input: string,
  init?: RequestInit,
): Promise<T | null> => {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetchImpl(input, {
    credentials: "include",
    ...init,
    headers,
  });
  if (!response.ok) {
    let details: unknown = null;
    try {
      if (hasJsonContentType(response)) {
        details = await response.clone().json();
      } else {
        const text = await response.clone().text();
        details = text.trim() ? text : null;
      }
    } catch {
      details = null;
    }
    const message = getErrorMessage(
      details,
      response.statusText || `Request failed with status ${response.status}`,
    );
    throw new PasskeyClientError(message, response.status, details);
  }

  if (response.status === 204) {
    return null;
  }

  if (hasJsonContentType(response)) {
    return response.json();
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

export const createClient = (options: CreateClientOptions = {}) => {
  const mountPath = normalizeMountPath(options.mountPath ?? DEFAULT_MOUNT_PATH);
  const fetchImpl: FetchLike = options.fetch ?? fetch;
  let dpopKeyPair: CryptoKeyPair | undefined = options.dpopKeyPair;
  const enableDpop = options.enableDpop ?? false;

  const ensureUsername = (username: string) => username.trim();

  const createDpopProofIfEnabled = async (
    method: string,
    url: string,
  ): Promise<string | undefined> => {
    if (!enableDpop || !dpopKeyPair) {
      return undefined;
    }
    try {
      return await createDpopProof({
        keyPair: dpopKeyPair,
        method,
        url,
      });
    } catch (error) {
      console.error("Failed to create DPoP proof:", error);
      return undefined;
    }
  };

  return {
    async initDpop(): Promise<void> {
      if (enableDpop && !dpopKeyPair) {
        dpopKeyPair = await generateDpopKeyPair();
      }
    },

    getDpopKeyPair(): CryptoKeyPair | undefined {
      return dpopKeyPair;
    },

    async register(params: RegisterParams): Promise<RegisterResult> {
      const username = ensureUsername(params.username);
      const optionsJSON = await fetchJson(
        fetchImpl,
        buildUrl(mountPath, "/register/options"),
        {
          method: "POST",
          body: JSON.stringify({ username }),
        },
      );
      const attestationResponse = await startRegistration(
        { optionsJSON } as Parameters<typeof startRegistration>[0],
      );

      const verifyUrl = buildUrl(mountPath, "/register/verify");
      const dpopProof = await createDpopProofIfEnabled("POST", verifyUrl);

      const verification = await fetchJson(
        fetchImpl,
        verifyUrl,
        {
          method: "POST",
          body: JSON.stringify({
            username,
            credential: attestationResponse,
            ...(dpopProof ? { dpopProof } : {}),
          }),
          headers: dpopProof ? { DPoP: dpopProof } : undefined,
        },
      );

      return verification as RegisterResult;
    },

    async authenticate(
      params: AuthenticateParams,
    ): Promise<AuthenticateResult> {
      const username = ensureUsername(params.username);

      const optionsJSON = await fetchJson(
        fetchImpl,
        buildUrl(mountPath, "/authenticate/options"),
        {
          method: "POST",
          body: JSON.stringify({ username }),
        },
      );

      const assertionResponse = await startAuthentication(
        { optionsJSON } as Parameters<typeof startAuthentication>[0],
      );

      const verifyUrl = buildUrl(mountPath, "/authenticate/verify");
      const dpopProof = await createDpopProofIfEnabled("POST", verifyUrl);

      const verification = await fetchJson(
        fetchImpl,
        verifyUrl,
        {
          method: "POST",
          body: JSON.stringify({
            username,
            credential: assertionResponse,
            ...(dpopProof ? { dpopProof } : {}),
          }),
          headers: dpopProof ? { DPoP: dpopProof } : undefined,
        },
      );

      return verification as AuthenticateResult;
    },

    async list(): Promise<PasskeyCredential[]> {
      const url = buildUrl(mountPath, "/credentials");

      const response = await fetchJson(fetchImpl, url);
      const credentials =
        (response && typeof response === "object" && "credentials" in response)
          ? (response as { credentials?: PasskeyCredential[] }).credentials ??
            []
          : [];
      return Array.isArray(credentials) ? credentials : [];
    },

    async delete(params: DeleteParams): Promise<void> {
      const credentialId = params.credentialId;
      const url = buildUrl(
        mountPath,
        `/credentials/${encodeURIComponent(credentialId)}`,
      );

      await fetchJson(fetchImpl, url, { method: "DELETE" });
    },

    async update(params: UpdateCredentialParams): Promise<PasskeyCredential> {
      const credentialId = params.credentialId;
      const url = buildUrl(
        mountPath,
        `/credentials/${encodeURIComponent(credentialId)}`,
      );

      const response = await fetchJson(
        fetchImpl,
        url,
        {
          method: "PATCH",
          body: JSON.stringify({ nickname: params.nickname }),
        },
      );

      if (
        response &&
        typeof response === "object" &&
        "credential" in response
      ) {
        return (response as { credential: PasskeyCredential }).credential;
      }

      throw new PasskeyClientError(
        "Unexpected response when updating credential",
        500,
        response,
      );
    },
  };
};

export { createDpopProof, generateDpopKeyPair } from "@scope/dpop";
export * from "@simplewebauthn/browser";
