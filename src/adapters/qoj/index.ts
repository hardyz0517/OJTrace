import type { BrowserSessionInput, FetchInput, OJAdapter } from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { normalizeQOJRecord } from "./normalizer";
import { isQOJLoginPage, parseQOJIdentity, parseQOJRecordPage } from "./parser";
import { qojHomeUrl, qojSubmissionListUrl } from "./urls";

function manualQOJCookie(account: FetchInput["account"]): string | undefined {
  const raw = account.cookie?.trim() || account.credentials?.cookie?.trim();
  if (raw) return /[\r\n]/.test(raw) ? undefined : raw;
  return qojCookieFromCredentials(account.credentials);
}

export function qojCookieFromCredentials(
  credentials: Record<string, string> | undefined,
): string | undefined {
  const sessionId = credentials?.UOJSESSIONID?.trim();
  if (sessionId && !/[\r\n;]/.test(sessionId)) {
    return `UOJSESSIONID=${sessionId}`;
  }
  const username = credentials?.uoj_username?.trim();
  const token = credentials?.uoj_remember_token?.trim();
  if (!username || !token || /[\r\n;]/.test(username) || /[\r\n;]/.test(token))
    return undefined;
  return `uoj_username=${encodeURIComponent(username)}; uoj_remember_token=${encodeURIComponent(token)}`;
}

function cookieRequestOptions(cookie: string | undefined) {
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml",
  };
  if (cookie) headers.Cookie = cookie;
  return {
    credentials: cookie ? ("omit" as const) : ("include" as const),
    headers,
  };
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
) {
  try {
    const options = cookieRequestOptions(cookie);
    return await input.http.request("qoj", url, {
      credentials: options.credentials,
      headers: options.headers,
      signal: input.signal,
    });
  } catch (error) {
    throw AdapterFailure.fromTransport(error, "qoj", input.requestId);
  }
}

export const qojAdapter: OJAdapter = {
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
        label: "Cookie 登录",
        description:
          "自动检测失败时，粘贴 QOJ Cookie；仅保存在本地，用于读取提交记录。",
        credentialFields: [
          {
            key: "cookie",
            label: "Cookie",
            type: "password",
            placeholder: "粘贴 QOJ 完整 Cookie（如 UOJSESSIONID=...）",
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
    try {
      const cookie = await input.http.request("qoj", qojHomeUrl(), {
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml" },
        signal: input.signal,
      });
      if (
        cookie.status === 401 ||
        /\/login(?:[/?#]|$)/i.test(cookie.url) ||
        isQOJLoginPage(cookie.text, cookie.url)
      )
        return { authenticated: false, status: "unauthenticated" as const };
      if (cookie.status === 403)
        return { authenticated: false, status: "permission-denied" as const };
      if (cookie.status === 429)
        return { authenticated: false, status: "network-error" as const };
      if (cookie.status < 200 || cookie.status >= 300)
        return { authenticated: false, status: "site-error" as const };
      const username = parseQOJIdentity(cookie.text);
      return username
        ? { authenticated: true, status: "authenticated" as const, username }
        : { authenticated: false, status: "unauthenticated" as const };
    } catch (error) {
      if (error instanceof Error) {
        return {
          authenticated: false,
          status: "network-error" as const,
          diagnostic: `request=${error.name}: ${error.message}`,
        };
      }
      return { authenticated: false, status: "network-error" as const };
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
        ? manualQOJCookie(input.account)
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
    let username = input.account.identifier.trim();
    if (!username) {
      const identityResponse = await request(input, qojHomeUrl(), manualCookie);
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
    const limit = Math.max(1, Math.min(input.limit, 100));
    const records = [];
    let page = 1;
    let hasMore = false;
    while (records.length < limit && page <= 10) {
      const response = await request(
        input,
        qojSubmissionListUrl(username, page),
        manualCookie,
      );
      if (isQOJLoginPage(response.text, response.url))
        throw failure(input, "auth_required", "request", response.status);
      if (response.status === 403)
        throw failure(input, "blocked", "request", response.status);
      if (response.status === 429)
        throw failure(input, "rate_limited", "request", response.status);
      if (response.status < 200 || response.status >= 300)
        throw failure(input, "network", "request", response.status);
      let parsed;
      try {
        parsed = parseQOJRecordPage(
          response.text,
          response.url || qojSubmissionListUrl(username, page),
        );
      } catch {
        throw failure(input, "parse_failed", "parse", response.status);
      }
      for (const raw of parsed.records) {
        if (records.length >= limit) break;
        records.push(
          normalizeQOJRecord(raw, input.account.accountId, username, input.now),
        );
      }
      hasMore = parsed.hasMore;
      if (!parsed.hasMore || parsed.records.length === 0) break;
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
      hasMore,
    };
  },
};
