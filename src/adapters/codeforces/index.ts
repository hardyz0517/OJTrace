import { authorizeFromRecent } from "../authorization";
import {
  cookieHeaderFromCredentials,
  credentialValue,
  type BrowserSessionInput,
  type FetchInput,
  type OJAdapter,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { normalizeCodeforcesSubmission } from "./normalizer";
import { parseCodeforcesResponse } from "./parser";

const CODEFORCES_HOME_URL = "https://codeforces.com/";

function parseCodeforcesUsername(text: string): string | undefined {
  const directIdentity = text.match(
    /(?:currentUser|current_user|userScreenName|username|handle)\s*[:=]\s*["']([^"']+)["']/i,
  )?.[1];
  if (directIdentity?.trim()) return directIdentity.trim();

  const profileLinks = [
    ...text.matchAll(/href=["']\/profile\/([^"'/?#]+)["']/gi),
  ];
  const navigationIdentity = text.match(
    /class=["'][^"']*(?:handle|user|profile)[^"']*["'][^>]*href=["']\/profile\/([^"'/?#]+)["']/i,
  )?.[1];
  const candidate = navigationIdentity ?? profileLinks[0]?.[1];
  if (!candidate) return undefined;
  try {
    return decodeURIComponent(candidate);
  } catch {
    return candidate;
  }
}

function isCodeforcesLoginPage(text: string): boolean {
  return (
    /(?:href|action)=["'][^"']*\/(?:enter|login)(?:[/?#"'])/i.test(text) &&
    !/\/(?:logout|exit)\b/i.test(text)
  );
}

async function currentCodeforcesUser(
  input:
    Pick<FetchInput, "http" | "signal" | "requestId"> | BrowserSessionInput,
  cookie?: string,
) {
  const identityMessageKey = cookie
    ? "account.identityFromCookieRequired"
    : "source.authRequired";
  const pageIdentity =
    "pageIdentity" in input ? input.pageIdentity?.trim() : undefined;
  if (pageIdentity && !cookie && !/\s/.test(pageIdentity)) {
    return pageIdentity;
  }
  let response;
  try {
    response = await input.http.request("codeforces", CODEFORCES_HOME_URL, {
      credentials: "include",
      headers: { Accept: "text/html" },
      ...(cookie ? { codeforcesCookie: cookie } : {}),
      followRedirects: true,
      signal: input.signal,
    });
  } catch (error) {
    throw AdapterFailure.fromTransport(error, "codeforces", input.requestId);
  }
  if (response.status === 401 || isCodeforcesLoginPage(response.text)) {
    throw new AdapterFailure({
      kind: "auth_required",
      source: "codeforces",
      stage: "identity",
      messageKey: identityMessageKey,
      retryable: false,
      userAction: "open_site_login",
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  if (response.status === 403) {
    throw new AdapterFailure({
      kind: "blocked",
      source: "codeforces",
      stage: "identity",
      messageKey: "source.blocked",
      retryable: false,
      userAction: "retry_later",
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  if (response.status === 429) {
    throw new AdapterFailure({
      kind: "rate_limited",
      source: "codeforces",
      stage: "identity",
      messageKey: "source.rateLimited",
      retryable: false,
      userAction: "retry_later",
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new AdapterFailure({
      kind: "network",
      source: "codeforces",
      stage: "identity",
      messageKey: "source.httpError",
      retryable: response.status >= 500,
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  const username = parseCodeforcesUsername(response.text);
  if (!username) {
    throw new AdapterFailure({
      kind: "auth_required",
      source: "codeforces",
      stage: "identity",
      messageKey: identityMessageKey,
      retryable: false,
      userAction: "open_site_login",
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  return username;
}

function manualCodeforcesCookie(
  credentials: Record<string, string> | undefined,
): string | undefined {
  const raw = credentialValue(credentials, "cookie");
  if (!raw) return undefined;
  const cookie = cookieHeaderFromCredentials(credentials, ["cookie"]);
  if (cookie) return cookie;
  // DevTools often exposes the JSESSIONID value separately from its name.
  // Accept that value as a convenience while still rejecting header-like data.
  return !/[;=\s\r\n]/.test(raw) ? `JSESSIONID=${raw}` : undefined;
}

function codeforcesRequestOptions(
  authMode: "browser-session" | "manual-cookie" | "public-handle",
  signal: AbortSignal,
) {
  const headers: Record<string, string> = { Accept: "application/json" };
  return {
    credentials:
      authMode === "browser-session" ? ("include" as const) : ("omit" as const),
    headers,
    signal,
  };
}

export const codeforcesAdapter: OJAdapter = {
  authorize(input) {
    return authorizeFromRecent(this, input);
  },
  metadata: {
    id: "codeforces",
    displayName: "Codeforces",
    availability: "stable",
    authModes: [
      {
        type: "browser-session",
        recommended: true,
        label: "使用当前浏览器登录状态",
        description: "使用当前浏览器中已经登录的 Codeforces 账号。",
      },
      {
        type: "manual-cookie",
        label: "手动配置",
        description:
          "粘贴 Codeforces Cookie（至少包含 JSESSIONID，建议完整复制），自动识别当前账号。也可只填 JSESSIONID 的值。",
        credentialFields: [
          {
            key: "cookie",
            label: "JSESSIONID",
            type: "password",
            credentialType: "cookie",
            placeholder: "粘贴 JSESSIONID 的值",
          },
        ],
        identifierRequired: false,
      },
      {
        type: "public-handle",
        label: "直接输入用户名",
        description: "直接输入 Codeforces 用户名，使用公开提交记录。",
      },
    ],
    capabilities: {
      accountLookup: true,
      stableSubmissionId: true,
      directSubmissionUrl: true,
      requiresBrowserSession: false,
      supportsAnonymous: true,
      supportsContentScriptFallback: false,
    },
  },

  async detectBrowserSession(input: BrowserSessionInput) {
    try {
      const username = await currentCodeforcesUser(input);
      return {
        authenticated: true,
        status: "authenticated" as const,
        username,
      };
    } catch (error) {
      if (!(error instanceof AdapterFailure)) {
        return { authenticated: false, status: "site-error" as const };
      }
      switch (error.error.kind) {
        case "auth_required":
          return { authenticated: false, status: "unauthenticated" as const };
        case "network":
        case "timeout":
          return { authenticated: false, status: "network-error" as const };
        case "blocked":
          return { authenticated: false, status: "site-error" as const };
        default:
          return { authenticated: false, status: "site-error" as const };
      }
    }
  },

  async fetchRecent(input: FetchInput) {
    const authMode = input.account.authMode;
    if (
      authMode !== "public-handle" &&
      authMode !== "browser-session" &&
      authMode !== "manual-cookie"
    ) {
      throw new AdapterFailure({
        kind: "unsupported",
        source: "codeforces",
        stage: "identity",
        messageKey: "account.authModeUnsupported",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    const cookie =
      authMode === "manual-cookie"
        ? manualCodeforcesCookie(input.credentials)
        : undefined;
    if (authMode === "manual-cookie" && !cookie) {
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "codeforces",
        stage: "identity",
        messageKey: "account.cookieRequired",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    const handle = (
      input.account.providerAccountKey ??
      input.account.identifier ??
      ""
    ).trim();
    let resolvedHandle = handle;
    if (!resolvedHandle && authMode !== "public-handle") {
      try {
        resolvedHandle = await currentCodeforcesUser(input, cookie);
      } catch (error) {
        if (error instanceof AdapterFailure) throw error;
        throw AdapterFailure.fromTransport(
          error,
          "codeforces",
          input.requestId,
        );
      }
    }
    if (!resolvedHandle) {
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "codeforces",
        stage: "identity",
        messageKey: "account.identifierRequired",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    let response;
    try {
      response = await input.http.request(
        "codeforces",
        `https://codeforces.com/api/user.status?handle=${encodeURIComponent(resolvedHandle)}&from=1&count=${Math.min(input.limit, 1000)}`,
        codeforcesRequestOptions(authMode, input.signal),
      );
    } catch (error) {
      throw AdapterFailure.fromTransport(error, "codeforces", input.requestId);
    }
    if (response.status === 429) {
      throw new AdapterFailure({
        kind: "rate_limited",
        source: "codeforces",
        stage: "request",
        messageKey: "source.rateLimited",
        retryable: false,
        userAction: "retry_later",
        httpStatus: response.status,
        requestId: input.requestId,
      });
    }
    if (response.status === 401) {
      throw new AdapterFailure({
        kind: "auth_required",
        source: "codeforces",
        stage: "request",
        messageKey: cookie
          ? "account.identityFromCookieRequired"
          : "source.authRequired",
        retryable: false,
        userAction: "open_site_login",
        httpStatus: response.status,
        requestId: input.requestId,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new AdapterFailure({
        kind: response.status === 403 ? "blocked" : "network",
        source: "codeforces",
        stage: "request",
        messageKey: "source.httpError",
        retryable: response.status >= 500,
        httpStatus: response.status,
        requestId: input.requestId,
      });
    }
    let parsed;
    try {
      parsed = parseCodeforcesResponse(response.text);
    } catch {
      throw new AdapterFailure({
        kind: "parse_failed",
        source: "codeforces",
        stage: "parse",
        messageKey: "source.invalidResponse",
        retryable: false,
        requestId: input.requestId,
      });
    }
    if (parsed.status === "FAILED") {
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "codeforces",
        stage: "request",
        messageKey:
          parsed.comment === "User not found"
            ? "account.notFound"
            : "source.apiFailed",
        retryable: false,
        userAction:
          parsed.comment === "User not found" ? "edit_account" : undefined,
        requestId: input.requestId,
      });
    }
    let records;
    try {
      records = (parsed.result ?? [])
        .map((item) =>
          normalizeCodeforcesSubmission(
            item,
            input.account.accountId,
            resolvedHandle,
            input.now,
          ),
        )
        .filter(
          (item) =>
            input.since === undefined || item.submittedAt >= input.since,
        );
    } catch {
      throw new AdapterFailure({
        kind: "parse_failed",
        source: "codeforces",
        stage: "normalize",
        messageKey: "source.invalidRecord",
        retryable: false,
        requestId: input.requestId,
      });
    }
    return {
      account: {
        accountId: input.account.accountId,
        source: "codeforces",
        providerAccountKey: resolvedHandle,
        displayName: resolvedHandle,
      },
      records,
      diagnostics: [],
      hasMore: records.length >= Math.min(input.limit, 1000),
    };
  },
};

export { codeforcesListUrl } from "./urls";
