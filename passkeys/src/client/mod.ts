import {
  type PublicKeyCredentialCreationOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import type { PasskeyCredential } from "../core/types.ts";

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

const postJson = async <T = unknown>(
  fetchImpl: FetchLike,
  input: string,
  init?: RequestInit,
): Promise<T | null> => {
  const headers = new Headers(init?.headers);
  if (init?.body) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }
  const response = await fetchImpl(input, {
    credentials: "include",
    method: "POST",
    ...init,
    headers,
  });
  if (response.status === 204) return null;
  if (response.ok) return response.json();

  let message = response.statusText;
  let details: unknown;
  try {
    if (hasJsonContentType(response)) {
      const data = await response.json();
      if (data && typeof data === "object" && "message" in data) {
        const message_ = (data as { message?: unknown }).message;
        if (typeof message_ === "string") message = message_.trim();
      }
    } else {
      const text = await response.text();
      details = text.trim();
    }
  } catch {
    details = null;
  }
  throw new PasskeyClientError(message, response.status, details);
};

export const createClient = (options: CreateClientOptions = {}) => {
  const mountPath = normalizeMountPath(options.mountPath ?? DEFAULT_MOUNT_PATH);
  const fetchImpl: FetchLike = options.fetch ?? fetch;

  const buildUrl = (mountPath: string, endpoint: string) =>
    `${mountPath}${endpoint}`;

  return {
    async register(params?: RegisterParams): Promise<RegisterResult> {
      const res = await postJson<{
        options: PublicKeyCredentialCreationOptionsJSON;
        sessionToken: string;
      }>(
        fetchImpl,
        buildUrl(mountPath, "/register/options"),
        {
          body: JSON.stringify({
            userId: params?.userId,
          }),
        },
      );
      if (!res) throw new Error("Invalid response from server");
      const { options, sessionToken } = res;
      const attestationResponse = await startRegistration(
        { optionsJSON: options } as Parameters<typeof startRegistration>[0],
      );

      const verification = await postJson(
        fetchImpl,
        buildUrl(mountPath, "/register/verify"),
        {
          method: "POST",
          body: JSON.stringify({
            credential: attestationResponse,
            sessionToken,
          }),
        },
      );

      return verification as RegisterResult;
    },

    async authenticate(): Promise<AuthenticateResult> {
      const res = await postJson<{
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        sessionToken: string;
      }>(
        fetchImpl,
        buildUrl(mountPath, "/authenticate/options"),
        { method: "POST" },
      );
      if (!res) throw new Error("Invalid response from server");
      const { options, sessionToken } = res;

      const assertionResponse = await startAuthentication(
        { optionsJSON: options } as Parameters<typeof startAuthentication>[0],
      );

      try {
        const verification = await postJson(
          fetchImpl,
          buildUrl(mountPath, "/authenticate/verify"),
          {
            method: "POST",
            body: JSON.stringify({
              credential: assertionResponse,
              sessionToken,
            }),
          },
        );

        return verification as AuthenticateResult;
      } catch (error) {
        if (
          error instanceof PasskeyClientError &&
          error.status === 401 &&
          "PublicKeyCredential" in globalThis &&
          "signalUnknownCredential" in PublicKeyCredential
        ) {
          const rpId = typeof error.details === "object" && error.details &&
            "rpId" in error.details && typeof error.details.rpId === "string" &&
            error.details.rpId;
          if (rpId) {
            await (PublicKeyCredential.signalUnknownCredential as (
              options: { rpId: string; credentialId: string },
            ) => Promise<void>)({
              rpId,
              credentialId: assertionResponse.id,
            });
          }
        }
        throw error;
      }
    },
  };
};

export * from "@simplewebauthn/browser";
