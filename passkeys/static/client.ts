import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import type { PasskeyCredential } from "../src/core/types.ts";

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
}

export interface RegisterParams {
  userId: string;
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

  const buildUrl = (mountPath: string, endpoint: string) => {
    return `${mountPath}${endpoint}`;
  };

  return {
    async register(params?: RegisterParams): Promise<RegisterResult> {
      const optionsJSON = await fetchJson(
        fetchImpl,
        buildUrl(mountPath, "/register/options"),
        {
          method: "POST",
          body: JSON.stringify({
            userId: params?.userId,
          }),
        },
      );
      const attestationResponse = await startRegistration(
        { optionsJSON } as Parameters<typeof startRegistration>[0],
      );

      const verification = await fetchJson(
        fetchImpl,
        buildUrl(mountPath, "/register/verify"),
        {
          method: "POST",
          body: JSON.stringify({
            credential: attestationResponse,
          }),
        },
      );

      return verification as RegisterResult;
    },

    async authenticate(): Promise<AuthenticateResult> {
      const optionsJSON = await fetchJson(
        fetchImpl,
        buildUrl(mountPath, "/authenticate/options"),
        { method: "POST" },
      );

      const assertionResponse = await startAuthentication(
        { optionsJSON } as Parameters<typeof startAuthentication>[0],
      );

      const verification = await fetchJson(
        fetchImpl,
        buildUrl(mountPath, "/authenticate/verify"),
        {
          method: "POST",
          body: JSON.stringify({
            credential: assertionResponse,
          }),
        },
      );

      return verification as AuthenticateResult;
    },
  };
};

export * from "@simplewebauthn/browser";
