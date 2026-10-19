/**
 * Minimal Cloudflare D1 HTTP client for the migration.
 *
 * The REST API is used instead of `wrangler d1 execute` so the migration does
 * not depend on a wrangler config (the Worker does not exist yet) or on which
 * CLI major the runner happens to install.
 *
 * Statements carry secrets — the signing key and the passkey sign secret — so
 * nothing here ever puts SQL text into an error, a log line, or a thrown
 * message. Failures are reported by statement index and the API's own message.
 *
 * @module
 */

export interface D1HttpOptions {
  accountId: string;
  databaseId: string;
  token: string;
  /** Statements per request. Kept well under the API's body limits. */
  batchSize?: number;
  fetchImpl?: typeof fetch;
}

export interface D1HttpClient {
  /** Run statements in order, batched. Rejects on the first failing batch. */
  run(statements: readonly string[]): Promise<void>;
}

/** Split into batches that respect both a count and a byte budget. */
export const batchStatements = (
  statements: readonly string[],
  maxCount: number,
  maxBytes: number,
): string[][] => {
  const batches: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const statement of statements) {
    const size = statement.length + 1;
    if (
      current.length > 0 &&
      (current.length >= maxCount || bytes + size > maxBytes)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(statement);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
};

export const createD1HttpClient = (opts: D1HttpOptions): D1HttpClient => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const batchSize = opts.batchSize ?? 50;
  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}` +
    `/d1/database/${opts.databaseId}/query`;

  return {
    async run(statements) {
      const batches = batchStatements(statements, batchSize, 80_000);
      let done = 0;
      for (const [i, batch] of batches.entries()) {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${opts.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ sql: batch.join("\n") }),
        });

        if (!response.ok) {
          // Deliberately not including the SQL or the token.
          const detail = await summariseError(response);
          throw new Error(
            `D1 request failed on batch ${i + 1}/${batches.length} ` +
              `(statements ${done + 1}-${done + batch.length}): ` +
              `HTTP ${response.status} ${detail}`,
          );
        }
        const body = await response.json().catch(() => null) as {
          success?: boolean;
          errors?: { message?: string }[];
        } | null;
        if (body && body.success === false) {
          const messages = (body.errors ?? []).map((e) => e.message).join("; ");
          throw new Error(
            `D1 rejected batch ${i + 1}/${batches.length} ` +
              `(statements ${done + 1}-${done + batch.length}): ${messages}`,
          );
        }
        done += batch.length;
        console.log(`  applied ${done}/${statements.length} statements`);
      }
    },
  };
};

/** The API's error text only — never the request body. */
const summariseError = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as {
      errors?: { message?: string; code?: number }[];
    };
    const messages = (body.errors ?? [])
      .map((e) => e.message ?? String(e.code ?? ""))
      .filter(Boolean);
    return messages.length > 0 ? messages.join("; ") : "(no error detail)";
  } catch {
    return "(unparseable error body)";
  }
};
