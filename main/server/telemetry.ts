import { OtlpExporter } from "bunseki/exporter";
import { type Context, type Next } from "hono";
import { HTTPException } from "hono/http-exception";

// @ts-ignore: generic exporter
const otlp = new OtlpExporter({ serviceName: "id.kbn.one" });

export const opentelemetryMiddleware = async (c: Context, next: Next) => {
  // @ts-ignore: generic exporter
  const span = otlp.onRequest(c.req.raw);

  if (c.req.routePath) {
    // @ts-ignore: Bunseki Span API uses addAttribute
    span.addAttribute("http.route", c.req.routePath);
  }

  let err: Error | undefined;
  try {
    await next();
  } catch (error) {
    err = error as Error;
    // @ts-ignore: Bunseki Span API uses addErrorEvent
    span.addErrorEvent(err);
    throw error;
  } finally {
    let status = c.res.status;
    if (err) {
      if (err instanceof HTTPException) {
        status = err.status;
      } else {
        status = 500;
      }
    }
    // @ts-ignore: Bunseki Span API uses addAttribute
    span.addAttribute("http.status_code", status);
    await span.post();
  }
};
