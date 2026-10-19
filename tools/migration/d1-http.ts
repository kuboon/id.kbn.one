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
  /**
   * Check the credential against the destination database before anything is
   * read or written. A bare 403 from D1 does not say whether the account id or
   * the token's permissions are wrong, so on failure this asks the token which
   * accounts it can see and reports which of the two it is.
   */
  preflight(): Promise<void>;
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
  const api = "https://api.cloudflare.com/client/v4";
  const database = `${api}/accounts/${opts.accountId}/d1/database/` +
    opts.databaseId;
  const endpoint = `${database}/query`;
  const authorized = { authorization: `Bearer ${opts.token}` };

  return {
    async preflight() {
      const response = await fetchImpl(database, { headers: authorized });
      if (response.ok) {
        const body = await response.json().catch(() => null) as {
          result?: { name?: string };
        } | null;
        console.log(
          `  credential ok; database ${body?.result?.name ?? opts.databaseId}`,
        );
        return;
      }

      // Account ids and names identify, they do not authenticate; the token
      // itself is never printed.
      const lines = [
        `cannot reach D1 database ${opts.databaseId} in account ` +
        `${opts.accountId}: HTTP ${response.status} ` +
        await summariseError(response),
      ];
      const accounts = await fetchImpl(`${api}/accounts`, {
        headers: authorized,
      }).catch(() => null);
      const listed = accounts?.ok
        ? ((await accounts.json().catch(() => null)) as {
          result?: { id?: string; name?: string }[];
        } | null)?.result ?? []
        : null;

      if (listed === null) {
        lines.push(
          "the token cannot list accounts either, so it is scoped to a " +
            "different account or is missing D1 → Edit",
        );
      } else if (listed.length === 0) {
        lines.push("the token can see no accounts at all");
      } else {
        lines.push(
          "the token can see: " +
            listed.map((a) => `${a.id} (${a.name})`).join(", "),
        );
        lines.push(
          listed.some((a) => a.id === opts.accountId)
            ? "that includes the account above, so the token is missing D1 " +
              "(Read for this check, Edit for the import) on it"
            : "the account above is not among them, so CLOUDFLARE_ACCOUNT_ID " +
              "points at the wrong account",
        );
      }
      throw new Error(lines.join("\n  "));
    },

    async run(statements) {
      const batches = batchStatements(statements, batchSize, 80_000);
      let done = 0;
      for (const [i, batch] of batches.entries()) {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { ...authorized, "content-type": "application/json" },
          body: JSON.stringify({ sql: batch.join("\n") }),
        });

        if (!response.ok) {
          // Deliberately not including the SQL or the token.
          const detail = await summariseError(response);
          throw new Error(
            `D1 request failed on batch ${i + 1}/${batches.length} ` +
              `(statements ${done + 1}-${done + batch.length}): ` +
              `HTTP ${response.status} ${detail}` +
              // The preflight already proved the account and a read; a 403 on
              // a write leaves only the write permission.
              (response.status === 403
                ? " — the token reaches the database but cannot write to it, " +
                  "so it is missing D1 → Edit"
                : ""),
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
