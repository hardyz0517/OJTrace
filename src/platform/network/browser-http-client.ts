import { createHttpClient, HttpClientError } from "./http-client";
import type { RateLimitRegistry } from "./rate-limit";
import { withCookieScope, withTemporaryCookies } from "./temporary-cookies";
import {
  normalizeCookieHeader,
  type HttpRequestOptions,
  type SourceId,
} from "../../domain";

const FIXED_ORIGINS: Partial<Record<SourceId, string>> = {
  atcoder: "https://atcoder.jp",
  qoj: "https://qoj.ac",
  codeforces: "https://codeforces.com",
  luogu: "https://www.luogu.com.cn",
};

function temporaryCredential(
  source: SourceId,
  url: string,
  options: HttpRequestOptions,
) {
  const origin = new URL(url).origin;
  const suppliedHeader = Object.entries(options.headers ?? {}).find(
    ([name]) => name.toLowerCase() === "cookie",
  );
  const raw = options.atcoderSessionCookie
    ? `REVEL_SESSION=${options.atcoderSessionCookie.trim().replace(/^REVEL_SESSION=/i, "")}`
    : (options.qojCookie ?? options.codeforcesCookie ?? suppliedHeader?.[1]);
  if (!raw) return undefined;
  const expected =
    source === "hydroj" ? options.hydroOrigin : FIXED_ORIGINS[source];
  if (
    !expected ||
    origin !== new URL(expected).origin ||
    (options.atcoderSessionCookie && source !== "atcoder") ||
    (options.qojCookie && source !== "qoj") ||
    (options.codeforcesCookie && source !== "codeforces")
  )
    throw new HttpClientError(
      "invalid_url",
      "Credential scope does not match request origin",
    );
  const normalized = normalizeCookieHeader(raw);
  if (!normalized)
    throw new Error(
      `${{ qoj: "QOJ", codeforces: "Codeforces", atcoder: "AtCoder", luogu: "Luogu", hydroj: "HydroOJ" }[source]} Cookie is invalid`,
    );
  const clean = { ...options };
  delete clean.atcoderSessionCookie;
  delete clean.qojCookie;
  delete clean.codeforcesCookie;
  if (suppliedHeader) {
    clean.headers = Object.fromEntries(
      Object.entries(options.headers!).filter(
        ([name]) => name.toLowerCase() !== "cookie",
      ),
    );
  }
  return {
    cookie: normalized,
    options: { ...clean, credentials: "include" as const },
  };
}

/** Browser-only credential transport; adapters never call browser.cookies. */
export function createBrowserHttpClient(
  options: { rateLimits?: RateLimitRegistry } = {},
) {
  const client = createHttpClient(options);
  return {
    async request(
      source: SourceId,
      url: string,
      options: HttpRequestOptions = {},
    ) {
      const temporary = temporaryCredential(source, url, options);
      const origin = new URL(url).origin;
      return withCookieScope(origin, () => {
        options.signal?.throwIfAborted();
        return temporary
          ? withTemporaryCookies(origin, temporary.cookie, () =>
              client.request(source, url, temporary.options),
            )
          : client.request(source, url, options);
      });
    },
    async getCookie(source: SourceId, url: string, name: string) {
      if (source !== "qoj" || new URL(url).origin !== FIXED_ORIGINS.qoj)
        return undefined;
      return withCookieScope(new URL(url).origin, async () => {
        const cookie = await browser.cookies.get({ url, name });
        return cookie?.value || undefined;
      });
    },
    async getCookies(source: SourceId, url: string) {
      if (source !== "qoj" || new URL(url).origin !== FIXED_ORIGINS.qoj)
        return {};
      return withCookieScope(new URL(url).origin, async () => {
        const cookies = await browser.cookies.getAll({ url });
        const result: Record<string, string> = {};
        for (const cookie of cookies) {
          // Keep unrelated tracking cookies out; these two Cloudflare cookies
          // are explicitly needed to reuse a completed QOJ challenge.
          if (
            !/^(?:(?:__Host-)?(?:UOJSESSID|UOJSESSIONID|UOJREMEMBER.*|uoj_username(?:_checksum)?|uoj_remember_token(?:_checksum)?)|(?:cf_clearance|__cf_bm))$/i.test(
              cookie.name,
            )
          )
            continue;
          if (cookie.value) result[cookie.name] = cookie.value;
        }
        return result;
      });
    },
  };
}
