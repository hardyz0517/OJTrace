import type { HttpResponse } from "../../src/domain/adapter";

/** Preserve fixture text exactly; tests can override every transport field. */
export function httpResponse(
  url: string,
  text: string,
  status = 200,
  overrides: Partial<HttpResponse> = {},
): HttpResponse {
  return {
    url,
    text,
    status,
    contentType: text.startsWith("{") ? "application/json" : "text/html",
    headers: new Headers(),
    ...overrides,
  };
}
