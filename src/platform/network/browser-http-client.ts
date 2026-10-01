import { createHttpClient } from "./http-client";
import type { HttpRequestOptions, SourceId } from "../../domain";

const ATCODER_ORIGIN = "https://atcoder.jp/";
const QOJ_ORIGIN = "https://qoj.ac/";
let cookieOperation = Promise.resolve();

function isAtCoderOfficialUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.origin === new URL(ATCODER_ORIGIN).origin;
  } catch {
    return false;
  }
}

function isQOJUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).origin === new URL(QOJ_ORIGIN).origin;
  } catch {
    return false;
  }
}

async function qojBrowserCookie(): Promise<string | undefined> {
  try {
    const cookie = await browser.cookies.get({
      url: QOJ_ORIGIN,
      name: "UOJSESSIONID",
    });
    if (cookie?.value && !/[\r\n;]/.test(cookie.value)) {
      return `${cookie.name}=${cookie.value}`;
    }
    const all = await browser.cookies.getAll({ domain: ".qoj.ac" });
    const fallback = all.find(
      (item) => item.name.toUpperCase() === "UOJSESSIONID",
    );
    return fallback?.value && !/[\r\n;]/.test(fallback.value)
      ? `${fallback.name}=${fallback.value}`
      : undefined;
  } catch {
    return undefined;
  }
}

function sessionValue(raw: string): string {
  const value = raw.trim().replace(/^REVEL_SESSION=/i, "");
  if (!value || /[\r\n]/.test(value)) {
    throw new Error("AtCoder session credential is invalid");
  }
  return value;
}

async function withTemporaryAtCoderCookie<T>(
  rawCookie: string,
  task: () => Promise<T>,
): Promise<T> {
  const operation = cookieOperation.then(async () => {
    const value = sessionValue(rawCookie);
    const previous = await browser.cookies.get({
      url: ATCODER_ORIGIN,
      name: "REVEL_SESSION",
    });
    let injected = false;
    try {
      await browser.cookies.set({
        url: ATCODER_ORIGIN,
        name: "REVEL_SESSION",
        value,
        path: "/",
        secure: true,
      });
      injected = true;
      return await task();
    } finally {
      // Do not overwrite the user's cookie unless this invocation actually
      // replaced it. This also keeps a failed cookies.set from deleting the
      // user's existing session.
      if (injected && previous) {
        await browser.cookies.set({
          url: ATCODER_ORIGIN,
          name: previous.name,
          value: previous.value,
          domain: previous.domain,
          path: previous.path,
          secure: previous.secure,
          httpOnly: previous.httpOnly,
          sameSite: previous.sameSite,
          expirationDate: previous.expirationDate,
        });
      } else if (injected) {
        await browser.cookies.remove({
          url: ATCODER_ORIGIN,
          name: "REVEL_SESSION",
        });
      }
    }
  });
  cookieOperation = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

/**
 * HTTP client used by the extension service worker.
 *
 * Requests intentionally stay in the extension context. In particular, this
 * client never opens or reuses a website tab to obtain a page session.
 */
export function createBrowserHttpClient() {
  const client = createHttpClient();
  return {
    request(source: SourceId, url: string, options: HttpRequestOptions = {}) {
      const cookie = options.atcoderSessionCookie;
      if (source === "atcoder" && cookie && isAtCoderOfficialUrl(url)) {
        const cleanOptions = { ...options };
        delete cleanOptions.atcoderSessionCookie;
        return withTemporaryAtCoderCookie(cookie, () =>
          client.request(source, url, cleanOptions),
        );
      }
      if (
        source === "qoj" &&
        options.credentials === "include" &&
        isQOJUrl(url) &&
        !Object.keys(options.headers ?? {}).some(
          (name) => name.toLowerCase() === "cookie",
        )
      ) {
        return qojBrowserCookie().then((qojCookie) => {
          if (!qojCookie) return client.request(source, url, options);
          const headers = {
            ...(options.headers ?? {}),
            Cookie: qojCookie,
          };
          return client.request(source, url, {
            ...options,
            credentials: "omit",
            headers,
          });
        });
      }
      if (cookie && source !== "atcoder")
        return client.request(source, url, options);
      return client.request(source, url, options);
    },
  };
}
