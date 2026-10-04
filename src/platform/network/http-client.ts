import type {
  HttpClient,
  HttpRequestOptions,
  HttpResponse,
} from "../../domain";
import type { SourceId } from "../../domain";
import { createRateLimitRegistry, type RateLimitRegistry } from "./rate-limit";

const ALLOWED_ORIGINS: Record<SourceId, readonly string[]> = {
  codeforces: ["https://codeforces.com/"],
  luogu: ["https://www.luogu.com.cn/"],
  qoj: ["https://qoj.ac/"],
  atcoder: ["https://atcoder.jp/"],
  hydroj: [],
};
const ATCODER_PROBLEMS_ORIGIN = "https://kenkoooo.com/";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const RETRY_DELAY_MS = 250;

export class HttpClientError extends Error {
  constructor(
    public readonly code:
      | "invalid_url"
      | "timeout"
      | "network"
      | "response_too_large"
      | "rate_limited",
    message: string,
    public readonly retryAfterMs?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "HttpClientError";
  }
}

function isAllowed(
  source: SourceId,
  rawUrl: string,
  allowedOrigins?: readonly string[],
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (
    (url.protocol !== "https:" &&
      !(source === "hydroj" && url.protocol === "http:")) ||
    url.username ||
    url.password
  )
    return false;
  return [...ALLOWED_ORIGINS[source], ...(allowedOrigins ?? [])].some(
    (origin) => {
      const allowed = new URL(origin);
      return url.origin === allowed.origin;
    },
  );
}

async function readLimited(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    await response.body?.cancel();
    throw new HttpClientError(
      "response_too_large",
      "Response exceeds size limit",
    );
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  let cancellation: Promise<void> | undefined;
  const cancel = (reason?: unknown): Promise<void> => {
    cancellation ??= reader.cancel(reason).catch(() => undefined);
    return cancellation;
  };
  const cancelFromSignal = () => {
    void cancel(signal.reason);
  };
  signal.addEventListener("abort", cancelFromSignal, { once: true });
  if (signal.aborted) cancelFromSignal();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const chunk = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await cancel();
        throw new HttpClientError(
          "response_too_large",
          "Response exceeds size limit",
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener("abort", cancelFromSignal);
    // Closing a pending read happens before the stream's underlying cancel()
    // promise necessarily settles. Hold HTTP/Cookie/page locks through that
    // cleanup instead of returning as soon as the read wakes after abort.
    if (signal.aborted) await cancel(signal.reason);
    else await cancellation;
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export interface HttpClientOptions {
  rateLimits?: RateLimitRegistry;
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const rateLimits = options.rateLimits ?? createRateLimitRegistry();
  return {
    async request(
      source: SourceId,
      url: string,
      options: HttpRequestOptions = {},
    ): Promise<HttpResponse> {
      const allowedOrigins =
        source === "hydroj" && options.hydroOrigin
          ? [options.hydroOrigin]
          : source === "atcoder" &&
              (options.atcoderProblemsApi ||
                options.atcoderProblemMetadataApi ||
                options.atcoderSubmissionPage)
            ? [ATCODER_PROBLEMS_ORIGIN]
            : undefined;
      if (
        !isAllowed(source, url, allowedOrigins) ||
        (options.atcoderSessionCookie && source !== "atcoder") ||
        (source === "atcoder" &&
          options.atcoderSessionCookie &&
          new URL(url).origin !== "https://atcoder.jp") ||
        (source === "atcoder" &&
          options.atcoderProblemsApi &&
          !new URL(url).pathname.startsWith(
            "/atcoder/atcoder-api/v3/user/submissions",
          )) ||
        (source === "atcoder" &&
          options.atcoderProblemMetadataApi &&
          new URL(url).pathname !== "/atcoder/resources/problems.json") ||
        (source === "atcoder" &&
          options.atcoderSubmissionPage &&
          !/^\/contests\/[^/]+\/submissions\/\d+$/.test(new URL(url).pathname))
      ) {
        throw new HttpClientError(
          "invalid_url",
          "URL is outside source allowlist",
        );
      }

      const canRetry = (options.method ?? "GET") === "GET";
      const origin = new URL(url).origin;
      let retried = false;
      while (true) {
        if (options.signal?.aborted) {
          throw (
            options.signal.reason ?? new DOMException("Aborted", "AbortError")
          );
        }
        await rateLimits.ready();
        if (options.signal?.aborted) {
          throw (
            options.signal.reason ?? new DOMException("Aborted", "AbortError")
          );
        }
        const retryAfterMs = rateLimits.getRetryAfterMs(origin);
        if (retryAfterMs > 0) {
          throw new HttpClientError(
            "rate_limited",
            "Request origin is cooling down after rate limiting",
            retryAfterMs,
            429,
          );
        }
        const controller = new AbortController();
        let timedOut = false;
        const abortFromCaller = () => controller.abort();
        options.signal?.addEventListener("abort", abortFromCaller, {
          once: true,
        });
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        let response: Response;
        try {
          try {
            response = await fetch(url, {
              method: options.method ?? "GET",
              headers: options.headers,
              body: options.body,
              credentials: options.atcoderSessionCookie
                ? "omit"
                : (options.credentials ?? "omit"),
              signal: controller.signal,
              // Follow only where the adapter needs redirects; followed
              // requests are checked again against the final response origin.
              redirect:
                options.followRedirects || source === "qoj"
                  ? "follow"
                  : "error",
            });
          } catch (error) {
            if (options.signal?.aborted) {
              throw (
                options.signal.reason ??
                new DOMException("Aborted", "AbortError")
              );
            }
            if (timedOut) {
              throw new HttpClientError("timeout", "Request timed out");
            }
            if (!canRetry || retried) {
              throw new HttpClientError(
                "network",
                error instanceof Error
                  ? error.message
                  : "Network request failed",
              );
            }
            retried = true;
            try {
              await waitForRetry(RETRY_DELAY_MS, options.signal);
            } catch {
              throw (
                options.signal?.reason ??
                new DOMException("Aborted", "AbortError")
              );
            }
            continue;
          }
          if (
            !isAllowed(source, response.url || url, allowedOrigins) ||
            (source === "atcoder" &&
              options.atcoderProblemsApi &&
              !new URL(response.url || url).pathname.startsWith(
                "/atcoder/atcoder-api/v3/user/submissions",
              )) ||
            (source === "atcoder" &&
              options.atcoderProblemMetadataApi &&
              new URL(response.url || url).pathname !==
                "/atcoder/resources/problems.json") ||
            (source === "atcoder" &&
              options.atcoderSubmissionPage &&
              !/^\/contests\/[^/]+\/submissions\/\d+$/.test(
                new URL(response.url || url).pathname,
              ))
          ) {
            throw new HttpClientError(
              "invalid_url",
              "Response redirected outside source allowlist",
            );
          }
          if (response.status === 429) {
            // Record from response headers, before body reads/adapter parsing.
            // The original response remains available for site diagnostics.
            rateLimits.record429(
              new URL(response.url || url).origin,
              response.headers.get("retry-after"),
            );
          }
          if (options.signal?.aborted) {
            await response.body?.cancel().catch(() => undefined);
            throw (
              options.signal.reason ?? new DOMException("Aborted", "AbortError")
            );
          }
          if (timedOut) {
            await response.body?.cancel().catch(() => undefined);
            throw new HttpClientError("timeout", "Request timed out");
          }
          if (
            canRetry &&
            !retried &&
            response.status >= 500 &&
            response.status < 600
          ) {
            retried = true;
            await response.body?.cancel().catch(() => undefined);
            try {
              await waitForRetry(RETRY_DELAY_MS, options.signal);
            } catch {
              throw (
                options.signal?.reason ??
                new DOMException("Aborted", "AbortError")
              );
            }
            continue;
          }
          let bytes: Uint8Array;
          try {
            bytes = await readLimited(
              response,
              options.maxBytes ?? DEFAULT_MAX_BYTES,
              controller.signal,
            );
          } catch (error) {
            if (options.signal?.aborted) {
              throw (
                options.signal.reason ??
                new DOMException("Aborted", "AbortError")
              );
            }
            if (timedOut)
              throw new HttpClientError("timeout", "Request timed out");
            throw error instanceof HttpClientError
              ? error
              : new HttpClientError(
                  "network",
                  "Response body could not be read",
                );
          }
          return {
            status: response.status,
            url: response.url || url,
            contentType: response.headers.get("content-type") ?? "",
            text:
              options.responseType === "bytes"
                ? ""
                : new TextDecoder().decode(bytes),
            ...(options.responseType === "bytes" ? { bytes } : {}),
            headers: response.headers,
          };
        } finally {
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", abortFromCaller);
        }
      }
    },
  };
}
