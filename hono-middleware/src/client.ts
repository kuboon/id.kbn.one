import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import type { PasskeyCredential } from "./types.ts";

const DEFAULT_MOUNT_PATH = "/webauthn";
declare const PASSKEY_ORIGIN: string | null;

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

const getDomErrorName = (error: unknown): string | null => {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name;
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    if (typeof DOMException !== "undefined" && cause instanceof DOMException) {
      return cause.name;
    }
  }
  return null;
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
  username: string;
  auto?: boolean;
}

export interface AuthenticateParams {
  username?: string;
  useAutofill?: boolean;
  verifyAutofillInput?: boolean;
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

export interface AuthenticateOrRegisterParams {
  username?: string;
  autoRegister?: boolean;
  useAutofill?: boolean;
  verifyAutofillInput?: boolean;
  createUsername?: () => string;
}

export type AuthenticateOrRegisterResult =
  | (AuthenticateResult & {
    kind: "authenticated";
    username: string | null;
  })
  | (RegisterResult & {
    kind: "registered";
    username: string;
  });

const buildUrl = (mountPath: string, endpoint: string) => {
  const path = `${mountPath}${endpoint}`;
  if (!PASSKEY_ORIGIN) return path;
  return new URL(path, PASSKEY_ORIGIN).toString();
};

const normalizeOptionalUsername = (username?: string) => username?.trim() ?? "";

const shouldAutoRegister = (
  error: unknown,
  hasUsername: boolean,
) => {
  if (error instanceof PasskeyClientError) {
    return error.status === 404;
  }
  if (hasUsername) {
    return false;
  }
  const errorName = getDomErrorName(error);
  return errorName === "NotAllowedError";
};

const generateRandomUsername = () => {
  const randomHex = () =>
    Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `kbn-${Date.now().toString(36)}-${randomHex()}`;
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

  const ensureUsername = (username: string) => username.trim();

  const register = async (
    params: RegisterParams,
  ): Promise<RegisterResult> => {
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
      {
        optionsJSON,
        useAutoRegister: Boolean(params.auto),
      } as Parameters<typeof startRegistration>[0],
    );

    const verification = await fetchJson(
      fetchImpl,
      buildUrl(mountPath, "/register/verify"),
      {
        method: "POST",
        body: JSON.stringify({
          username,
          credential: attestationResponse,
        }),
      },
    );

    return verification as RegisterResult;
  };

  const authenticate = async (
    params: AuthenticateParams = {},
  ): Promise<AuthenticateResult> => {
    const username = normalizeOptionalUsername(params.username);
    const useAutofill = Boolean(params.useAutofill);
    const verifyAutofillInput = params.verifyAutofillInput ?? false;

    const optionsJSON = await fetchJson(
      fetchImpl,
      buildUrl(mountPath, "/authenticate/options"),
      {
        method: "POST",
        body: JSON.stringify(
          username ? { username } : {},
        ),
      },
    );

    const assertionResponse = await startAuthentication(
      {
        optionsJSON,
        useBrowserAutofill: useAutofill,
        verifyBrowserAutofillInput: verifyAutofillInput,
      } as Parameters<typeof startAuthentication>[0],
    );

    const verification = await fetchJson(
      fetchImpl,
      buildUrl(mountPath, "/authenticate/verify"),
      {
        method: "POST",
        body: JSON.stringify(
          username ? { username, credential: assertionResponse } : {
            credential: assertionResponse,
            challenge: (optionsJSON as { challenge: string }).challenge,
            origin: globalThis.location?.origin ?? "",
          },
        ),
      },
    );

    return verification as AuthenticateResult;
  };

  return {
    async register(params: RegisterParams): Promise<RegisterResult> {
      return await register(params);
    },

    async authenticate(
      params: AuthenticateParams,
    ): Promise<AuthenticateResult> {
      return await authenticate(params);
    },

    async authenticateOrRegister(
      params: AuthenticateOrRegisterParams = {},
    ): Promise<AuthenticateOrRegisterResult> {
      const username = normalizeOptionalUsername(params.username);
      const hasUsername = Boolean(username);
      const autoRegister = params.autoRegister ?? true;
      const useAutofill = Boolean(params.useAutofill);
      const verifyAutofillInput = params.verifyAutofillInput ?? false;

      try {
        const result = await authenticate({
          username,
          useAutofill,
          verifyAutofillInput,
        });
        return {
          ...result,
          kind: "authenticated",
          username: username || null,
        };
      } catch (error) {
        if (!autoRegister || !shouldAutoRegister(error, hasUsername)) {
          throw error;
        }
        const createUsername = params.createUsername ?? generateRandomUsername;
        const nextUsername = hasUsername ? username : createUsername();
        const registration = await register({
          username: nextUsername,
          auto: useAutofill && !hasUsername,
        });
        return {
          ...registration,
          kind: "registered",
          username: nextUsername,
        };
      }
    },

    async list(params: ListParams): Promise<PasskeyCredential[]> {
      const username = ensureUsername(params.username);
      const url = `${buildUrl(mountPath, "/credentials")}?username=${
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
        )
      }?username=${encodeURIComponent(username)}`;

      await fetchJson(fetchImpl, url, { method: "DELETE" });
    },

    async isAutofillAvailable(): Promise<boolean> {
      try {
        return await browserSupportsWebAuthnAutofill();
      } catch {
        return false;
      }
    },
  };
};

export * from "@simplewebauthn/browser";
