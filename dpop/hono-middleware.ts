import type {} from "hono";
import type { MiddlewareHandler } from "hono/types";
import { HTTPException } from "hono/http-exception";
import type { VerifyDpopProofOptions, VerifyDpopProofResult } from "./types.ts";
import { verifyDpopProofFromRequest } from "./server.ts";

declare module "hono" {
  interface ContextVariableMap {
    dpop?: VerifyDpopProofResult;
  }
}

export type DpopMiddlewareOptions = Omit<VerifyDpopProofOptions, "proof" | "method" | "url">

export const createDpopMiddleware = (
  options: DpopMiddlewareOptions = {},
): MiddlewareHandler => {

  return async (c, next) => {
    const result = await verifyDpopProofFromRequest(c.req.raw, options);
    c.set("dpop", result);
    if (!result.valid) {
      throw new HTTPException(401, { message: result.error ?? "invalid-dpop" });
    }
    return next();
  };
};
