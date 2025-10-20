import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import type { PasskeyCredential } from "./types.ts";

const DEFAULT_MOUNT_PATH = "/webauthn";

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
  /**
   * Base origin for the passkey server. When provided, relative request paths
   * are resolved against this origin before being sent through `fetch`.
   */
  origin?: string | URL;
}

export interface RegisterParams {
  username: string;
}

export interface AuthenticateParams {
  username: string;
}

export interface ListParams {
  username: string;
}

export interface DeleteParams {
  username: string;
  credentialId: string;
}

export interface RegisterResult {
  verified: boolean;
  credential: PasskeyCredential;
}

export interface AuthenticateResult {
  verified: boolean;
  credential: PasskeyCredential;
}

const buildUrl = (
  mountPath: string,
  endpoint: string,
  origin?: string | URL,
) => {
  const path = `${mountPath}${endpoint}`;
  if (!origin) {
    return path;
  }
  const baseUrl = origin instanceof URL ? origin : new URL(origin);
  return new URL(path, baseUrl).toString();
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
  const origin = options.origin;

  const ensureUsername = (username: string) => username.trim();

  return {
    async register(params: RegisterParams): Promise<RegisterResult> {
      const username = ensureUsername(params.username);
      const optionsJSON = await fetchJson(
        fetchImpl,
        buildUrl(mountPath, "/register/options", origin),
        {
          method: "POST",
          body: JSON.stringify({ username }),
        },
      );
      const attestationResponse = await startRegistration(
        { optionsJSON } as Parameters<typeof startRegistration>[0],
      );

      const verification = await fetchJson(
        fetchImpl,
        buildUrl(mountPath, "/register/verify", origin),
        {
          method: "POST",
          body: JSON.stringify({
            username,
            credential: attestationResponse,
          }),
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
        buildUrl(mountPath, "/authenticate/options", origin),
        {
          method: "POST",
          body: JSON.stringify({ username }),
        },
      );

      const assertionResponse = await startAuthentication(
        { optionsJSON } as Parameters<typeof startAuthentication>[0],
      );

      const verification = await fetchJson(
        fetchImpl,
        buildUrl(mountPath, "/authenticate/verify", origin),
        {
          method: "POST",
          body: JSON.stringify({
            username,
            credential: assertionResponse,
          }),
        },
      );

      return verification as AuthenticateResult;
    },

    async list(params: ListParams): Promise<PasskeyCredential[]> {
      const username = ensureUsername(params.username);
      const url = `${buildUrl(mountPath, "/credentials", origin)}?username=${
        encodeURIComponent(username)
      }`;

      const response = await fetchJson(fetchImpl, url);
      const credentials =
        (response && typeof response === "object" && "credentials" in response)
          ? (response as { credentials?: PasskeyCredential[] }).credentials ??
            []
          : [];
      return Array.isArray(credentials) ? credentials : [];
    },

    async delete(params: DeleteParams): Promise<void> {
      const username = ensureUsername(params.username);
      const credentialId = params.credentialId;
      const url = `${
        buildUrl(
          mountPath,
          `/credentials/${encodeURIComponent(credentialId)}`,
          origin,
        )
      }?username=${encodeURIComponent(username)}`;

      await fetchJson(fetchImpl, url, { method: "DELETE" });
    },
  };
};

export * from "@simplewebauthn/browser";
