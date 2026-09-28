import type {
  HttpClient,
  HttpRequestOptions,
  HttpResponse,
} from "../../domain";
import type { SourceId } from "../../domain";

const ALLOWED_ORIGINS: Record<SourceId, readonly string[]> = {
  codeforces: ["https://codeforces.com/"],
  luogu: ["https://www.luogu.com.cn/"],
  qoj: ["https://qoj.ac/"],
  loj: ["https://loj.ac/", "https://api.loj.ac/"],
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2_000_000;

export class HttpClientError extends Error {
  constructor(
    public readonly code:
      "invalid_url" | "timeout" | "network" | "response_too_large",
    message: string,
  ) {
    super(message);
    this.name = "HttpClientError";
  }
}

function isAllowed(source: SourceId, rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_ORIGINS[source].some((origin) => url.href.startsWith(origin));
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) {
    throw new HttpClientError(
      "response_too_large",
      "Response exceeds size limit",
    );
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new HttpClientError(
      "response_too_large",
      "Response exceeds size limit",
    );
  }
  return new TextDecoder().decode(buffer);
}

export function createHttpClient(): HttpClient {
  return {
    async request(
      source: SourceId,
      url: string,
      options: HttpRequestOptions = {},
    ): Promise<HttpResponse> {
      if (!isAllowed(source, url)) {
        throw new HttpClientError(
          "invalid_url",
          "URL is outside source allowlist",
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      try {
        let response: Response;
        try {
          response = await fetch(url, {
            method: options.method ?? "GET",
            headers: options.headers,
            body: options.body,
            credentials: options.credentials ?? "omit",
            signal: controller.signal,
            redirect: "error",
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new HttpClientError("timeout", "Request timed out");
          }
          throw new HttpClientError(
            "network",
            error instanceof Error ? error.message : "Network request failed",
          );
        }
        const text = await readLimited(
          response,
          options.maxBytes ?? DEFAULT_MAX_BYTES,
        );
        return {
          status: response.status,
          url: response.url || url,
          contentType: response.headers.get("content-type") ?? "",
          text,
          headers: response.headers,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
