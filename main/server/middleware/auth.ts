/**
 * Auth primitives used by the root error handler and by JSON action handlers.
 *
 * `AuthRequiredError` is thrown by middleware (e.g. `requireUser` in
 * `./user.ts`) and by handler-level checks; the root error handler converts
 * it to a 401 JSON response.
 */

export class AuthRequiredError extends Error {
  readonly response: Response;
  constructor(message = "Sign-in required") {
    super(message);
    this.response = Response.json({ message }, { status: 401 });
  }
}

export const setNoStore = (response: Response): Response => {
  response.headers.set("cache-control", "no-store");
  return response;
};
