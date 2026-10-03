import { authorizeFromRecent } from "../authorization";
import {
  cookieHeaderFromCredentials,
  type BrowserSessionInput,
  type FetchInput,
  normalizeCookieHeader,
  type OJAdapter,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { normalizeQOJRecord } from "./normalizer";
import {
  isQOJCloudflarePage,
  isQOJLoginPage,
  parseQOJIdentity,
  parseQOJRecordPage,
} from "./parser";
import { qojHomeUrl, qojSubmissionListUrl } from "./urls";

const QOJ_SESSION_COOKIE_NAMES = [
  "__Host-UOJSESSID",
  "__Host-UOJSESSIONID",
  "UOJSESSID",
  "UOJSESSIONID",
] as const;
const QOJ_AUTH_COOKIE_NAMES = [
  ...QOJ_SESSION_COOKIE_NAMES,
  "__Host-UOJREMEMBER",
  "__Host-UOJREMEMBER_TOKEN",
  "__Host-UOJREMEMBERME",
  "uoj_username",
  "uoj_username_checksum",
  "uoj_remember_token",
  "uoj_remember_token_checksum",
  "cf_clearance",
  "__cf_bm",
] as const;
const QOJ_AUTH_COOKIE_PATTERN =
  /^(?:(?:__Host-)?(?:UOJSESSID|UOJSESSIONID|UOJREMEMBER.*|uoj_username(?:_checksum)?|uoj_remember_token(?:_checksum)?)|(?:cf_clearance|__cf_bm))$/i;

function manualQOJCookie(
  credentials: Record<string, string> | undefined,
): string | undefined {
  return (
    cookieHeaderFromCredentials(credentials, [
      "cookie",
      "__Host-UOJSESSID",
      "UOJSESSID",
      "UOJSESSIONID",
      "uoj_username",
      "uoj_remember_token",
    ]) || qojCookieFromCredentials(credentials)
  );
}

export function qojCookieFromCredentials(
  credentials: Record<string, string> | undefined,
): string | undefined {
  const sessionName = QOJ_SESSION_COOKIE_NAMES.find((name) =>
    credentials?.[name]?.trim(),
  );
  if (sessionName) {
    const sessionId = credentials?.[sessionName]?.trim();
    if (sessionId && !/[\r\n;]/.test(sessionId)) {
      return `${sessionName}=${sessionId}`;
    }
  }
  const username = credentials?.uoj_username?.trim();
  const token = credentials?.uoj_remember_token?.trim();
  if (!username || !token || /[\r\n;]/.test(username) || /[\r\n;]/.test(token))
    return undefined;
  return `uoj_username=${encodeURIComponent(username)}; uoj_remember_token=${encodeURIComponent(token)}`;
}

function cookieRequestOptions(cookie: string | undefined) {
  return {
    credentials: "include" as const,
    headers: { Accept: "text/html,application/xhtml+xml" },
    ...(cookie ? { qojCookie: cookie } : {}),
  };
}

function qojIdentityDiagnostic(text: string, finalUrl: string): string {
  const markers = [...text.matchAll(/class=["'][^"']*\buoj-username\b/gi)]
    .length;
  const profiles = [...text.matchAll(/\/user\/profile\//gi)].length;
  const legacy = [...text.matchAll(/data-link=["']0["']/gi)].length;
  const logout = /\/logout(?:[?"'])/i.test(text) ? "present" : "missing";
  return `qoj-identity-missing; final=${qojDiagnosticUrl(finalUrl)}; logout=${logout}; markers=${markers}; profiles=${profiles}; legacy=${legacy}`;
}

function qojDiagnosticUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

/** Preserve transport stages without ever returning raw credential errors. */
function qojErrorDiagnostic(error: unknown): string {
  let cause = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!(cause instanceof Error)) return "error=unknown";
    if (cause instanceof AdapterFailure && cause.cause) {
      cause = cause.cause;
      continue;
    }
    const details = [`error=${cause.name}`];
    if ("code" in cause && /^[a-z_-]+$/i.test(String(cause.code)))
      details.push(`code=${String(cause.code)}`);
    if (
      "cookieName" in cause &&
      QOJ_AUTH_COOKIE_PATTERN.test(String(cause.cookieName))
    )
      details.push(`cookie=${String(cause.cookieName)}`);
    return details.join("; ");
  }
  return "error=unknown";
}

function decodeQOJCookieUsername(raw: string): string | undefined {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    value = raw;
  }
  value = value.trim();
  return value &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/^guest$/i.test(value)
    ? value
    : undefined;
}

function failure(
  input: FetchInput,
  kind:
    "auth_required" | "blocked" | "rate_limited" | "network" | "parse_failed",
  stage: "identity" | "request" | "parse",
  status?: number,
): AdapterFailure {
  return new AdapterFailure({
    kind,
    source: "qoj",
    stage,
    messageKey:
      kind === "auth_required"
        ? "source.authRequired"
        : kind === "blocked"
          ? "source.blocked"
          : kind === "rate_limited"
            ? "source.rateLimited"
            : kind === "parse_failed"
              ? "source.invalidResponse"
              : "source.httpError",
    retryable: kind === "network",
    userAction:
      kind === "auth_required"
        ? "open_site_login"
        : kind === "rate_limited" || kind === "blocked"
          ? "retry_later"
          : undefined,
    ...(status !== undefined ? { httpStatus: status } : {}),
    requestId: input.requestId,
  });
}

async function request(
  input: Pick<FetchInput, "http" | "signal" | "requestId">,
  url: string,
  cookie?: string,
  useBrowserCookies = false,
  trace: string[] = [],
) {
  let suppliedCookie = cookie;
  if (!suppliedCookie && useBrowserCookies) {
    // Snapshot before the first HTTP request: an anonymous response can issue
    // a new guest session and replace the user's existing session cookie.
    let values: Record<string, string> = {};
    try {
      if (input.http.getCookies) {
        values = await input.http.getCookies("qoj", qojHomeUrl());
      } else if (input.http.getCookie) {
        for (const name of QOJ_AUTH_COOKIE_NAMES) {
          const value = await input.http.getCookie("qoj", qojHomeUrl(), name);
          if (value) values[name] = value;
        }
      } else {
        trace.push("cookie-store=unavailable");
      }
      const entries = Object.entries(values).filter(
        ([name, value]) => QOJ_AUTH_COOKIE_PATTERN.test(name) && Boolean(value),
      );
      trace.push(
        `cookies=${
          entries
            .map(([name]) => name)
            .sort()
            .join(",") || "none"
        }`,
      );
      suppliedCookie = normalizeCookieHeader(
        entries.map(([name, value]) => `${name}=${value}`).join("; "),
      );
    } catch (error) {
      trace.push(`cookie-store-read-failed; ${qojErrorDiagnostic(error)}`);
      throw AdapterFailure.fromTransport(error, "qoj", input.requestId);
    }
  }
  try {
    trace.push(
      `transport=${suppliedCookie ? "cookie-store" : "browser-managed"}`,
    );
    const options = cookieRequestOptions(suppliedCookie);
    const response = await input.http.request("qoj", url, {
      credentials: options.credentials,
      headers: options.headers,
      ...(options.qojCookie ? { qojCookie: options.qojCookie } : {}),
      signal: input.signal,
    });
    trace.push(
      `status=${response.status}; final=${qojDiagnosticUrl(response.url)}`,
    );
    return response;
  } catch (error) {
    trace.push(qojErrorDiagnostic(error));
    throw AdapterFailure.fromTransport(error, "qoj", input.requestId);
  }
}

export const qojAdapter: OJAdapter = {
  authorize(input) {
    return authorizeFromRecent(this, input);
  },
  metadata: {
    id: "qoj",
    displayName: "QOJ",
    availability: "experimental",
    authModes: [
      {
        type: "browser-session",
        recommended: true,
        label: "使用当前浏览器登录状态",
        description:
          "QOJ/UOJ 的提交列表需要登录；使用当前浏览器中的 QOJ 会话。",
      },
      {
        type: "manual-cookie",
        label: "手动配置",
        description:
          "自动检测失败时，粘贴 QOJ Cookie；仅保存在本地，用于读取提交记录。",
        credentialFields: [
          {
            key: "cookie",
            label: "Cookie",
            type: "password",
            credentialType: "cookie",
            placeholder: "粘贴 QOJ 完整 Cookie（如 __Host-UOJSESSID=...）",
          },
        ],
        identifierRequired: false,
      },
    ],
    capabilities: {
      accountLookup: true,
      stableSubmissionId: true,
      directSubmissionUrl: true,
      requiresBrowserSession: true,
      supportsAnonymous: false,
      supportsContentScriptFallback: false,
    },
  },

  async detectBrowserSession(input: BrowserSessionInput) {
    const trace: string[] = [];
    const withCookieDiagnostic = (diagnostic: string) =>
      `${diagnostic}; ${trace.join("; ")}; requestId=${input.requestId}`;
    try {
      const cookie = await request(
        input,
        "https://qoj.ac/submissions",
        undefined,
        true,
        trace,
      );
      if (isQOJCloudflarePage(cookie.text))
        return {
          authenticated: false,
          status: "site-error" as const,
          diagnostic: withCookieDiagnostic("qoj-cloudflare-challenge"),
        };
      if (
        cookie.status === 401 ||
        /\/login(?:[/?#]|$)/i.test(cookie.url) ||
        isQOJLoginPage(cookie.text, cookie.url)
      ) {
        return {
          authenticated: false,
          status: "unauthenticated" as const,
          diagnostic: withCookieDiagnostic("qoj-login-page"),
        };
      }
      if (cookie.status === 403)
        return {
          authenticated: false,
          status: "site-error" as const,
          diagnostic: withCookieDiagnostic("qoj-forbidden"),
        };
      if (cookie.status === 429)
        return {
          authenticated: false,
          status: "network-error" as const,
          diagnostic: withCookieDiagnostic("qoj-rate-limited"),
        };
      if (cookie.status < 200 || cookie.status >= 300)
        return {
          authenticated: false,
          status: "site-error" as const,
          diagnostic: withCookieDiagnostic(`qoj-http-${cookie.status}`),
        };
      const username = parseQOJIdentity(cookie.text);
      if (!username || !/\/submissions(?:[/?#]|$)/i.test(cookie.url)) {
        return {
          authenticated: false,
          status: "site-error" as const,
          diagnostic: withCookieDiagnostic(
            qojIdentityDiagnostic(cookie.text, cookie.url),
          ),
        };
      }
      return username
        ? { authenticated: true, status: "authenticated" as const, username }
        : { authenticated: false, status: "unauthenticated" as const };
    } catch (error) {
      if (error instanceof AdapterFailure) {
        return {
          authenticated: false,
          status: "network-error" as const,
          diagnostic: withCookieDiagnostic(
            `request-failure; kind=${error.error.kind}; stage=${error.error.stage}; key=${error.error.messageKey}`,
          ),
        };
      }
      if (error instanceof Error) {
        return {
          authenticated: false,
          status: "network-error" as const,
          diagnostic: withCookieDiagnostic(
            `qoj-request-error; ${qojErrorDiagnostic(error)}`,
          ),
        };
      }
      return {
        authenticated: false,
        status: "network-error" as const,
        diagnostic: withCookieDiagnostic("qoj-request-error"),
      };
    }
  },

  async fetchRecent(input: FetchInput) {
    if (
      input.account.authMode !== "browser-session" &&
      input.account.authMode !== "manual-cookie"
    ) {
      throw new AdapterFailure({
        kind: "unsupported",
        source: "qoj",
        stage: "identity",
        messageKey: "account.authModeUnsupported",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    const manualCookie =
      input.account.authMode === "manual-cookie"
        ? manualQOJCookie(input.credentials)
        : undefined;
    if (input.account.authMode === "manual-cookie" && !manualCookie) {
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "qoj",
        stage: "identity",
        messageKey: "account.cookieRequired",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    let username = (
      input.account.providerAccountKey ??
      input.account.identifier ??
      ""
    ).trim();
    if (!username) {
      const identityResponse = await request(
        input,
        qojHomeUrl(),
        manualCookie,
        input.account.authMode === "browser-session",
      );
      if (
        isQOJCloudflarePage(identityResponse.text) ||
        identityResponse.status === 403
      )
        throw failure(input, "blocked", "identity", identityResponse.status);
      if (isQOJLoginPage(identityResponse.text, identityResponse.url))
        throw failure(
          input,
          "auth_required",
          "identity",
          identityResponse.status,
        );
      username = parseQOJIdentity(identityResponse.text) ?? "";
    }
    if (!/^[a-zA-Z0-9_]{1,32}$/.test(username)) {
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "qoj",
        stage: "identity",
        messageKey: "account.identifierRequired",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    let browserCookieUsername: string | undefined;
    if (input.account.authMode === "browser-session" && input.http.getCookie) {
      const raw = await input.http.getCookie(
        "qoj",
        "https://qoj.ac/",
        "uoj_username",
      );
      browserCookieUsername = raw ? decodeQOJCookieUsername(raw) : undefined;
      if (browserCookieUsername && browserCookieUsername !== username) {
        throw failure(input, "auth_required", "identity");
      }
    }
    const limit = Math.max(1, Math.min(input.limit, 1_000));
    const records = [];
    let page = 1;
    let hasMore = false;
    let reachedSince = false;
    while (records.length < limit && page <= 100) {
      const listUrl = qojSubmissionListUrl(username, page);
      const response = await request(
        input,
        listUrl,
        manualCookie,
        input.account.authMode === "browser-session",
      );
      if (isQOJCloudflarePage(response.text) || response.status === 403)
        throw failure(input, "blocked", "request", response.status);
      if (isQOJLoginPage(response.text, response.url))
        throw failure(input, "auth_required", "request", response.status);
      if (response.status === 429)
        throw failure(input, "rate_limited", "request", response.status);
      if (response.status < 200 || response.status >= 300)
        throw failure(input, "network", "request", response.status);
      let finalUrl: URL;
      try {
        finalUrl = new URL(response.url || listUrl);
      } catch {
        throw failure(input, "parse_failed", "request", response.status);
      }
      if (
        finalUrl.origin !== "https://qoj.ac" ||
        finalUrl.pathname !== "/submissions" ||
        finalUrl.searchParams.get("submitter") !== username
      ) {
        throw failure(input, "parse_failed", "request", response.status);
      }
      let parsed;
      try {
        parsed = parseQOJRecordPage(response.text, finalUrl.href);
      } catch {
        throw failure(input, "parse_failed", "parse", response.status);
      }
      const pageIdentity = browserCookieUsername ?? parsed.username;
      if (pageIdentity !== username) {
        throw failure(input, "auth_required", "identity", response.status);
      }
      const pageRecords = parsed.records.map((raw) =>
        normalizeQOJRecord(raw, input.account.accountId, username, input.now),
      );
      reachedSince =
        input.since !== undefined &&
        pageRecords.some((record) => record.submittedAt < input.since!);
      for (const record of pageRecords) {
        if (records.length >= limit) break;
        if (input.since === undefined || record.submittedAt >= input.since) {
          records.push(record);
        }
      }
      hasMore = parsed.hasMore;
      if (!parsed.hasMore || parsed.records.length === 0 || reachedSince) break;
      page += 1;
    }
    return {
      account: {
        accountId: input.account.accountId,
        source: "qoj" as const,
        providerAccountKey: username,
        displayName: username,
      },
      records,
      diagnostics: [],
      hasMore: hasMore && !reachedSince,
    };
  },
};
