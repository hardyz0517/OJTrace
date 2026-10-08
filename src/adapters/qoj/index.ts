import {
  finalizeCoverage,
  isCollectionDeadline,
} from "../shared/submission-window";
import { isWithinSyncWindow } from "../../domain/sync-range";
import {
  cookieHeaderFromCredentials,
  type BrowserSessionInput,
  type FetchInput,
  type AuthorizeInput,
  type PartialReason,
  type Submission,
  type Diagnostic,
  normalizeCookieHeader,
  type OJAdapter,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { reportProgress } from "../../domain/sync-progress";
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
    // eslint-disable-next-line no-control-regex -- Decoded usernames must reject control characters.
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/^guest$/i.test(value)
    ? value
    : undefined;
}

function failure(
  input: Pick<AuthorizeInput, "requestId">,
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
      if (input.signal.aborted) throw input.signal.reason;
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
    if (input.signal.aborted) throw input.signal.reason;
    trace.push(qojErrorDiagnostic(error));
    throw AdapterFailure.fromTransport(error, "qoj", input.requestId);
  }
}

export const qojAdapter: OJAdapter = {
  async authorize(input) {
    if (
      input.account.authMode !== "browser-session" &&
      input.account.authMode !== "manual-cookie"
    )
      throw new AdapterFailure({
        kind: "unsupported",
        source: "qoj",
        stage: "identity",
        messageKey: "account.authModeUnsupported",
        retryable: false,
        requestId: input.requestId,
      });
    const cookie =
      input.account.authMode === "manual-cookie"
        ? manualQOJCookie(input.credentials)
        : undefined;
    if (input.account.authMode === "manual-cookie" && !cookie)
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "qoj",
        stage: "identity",
        messageKey: "account.cookieRequired",
        retryable: false,
        requestId: input.requestId,
      });
    const response = await request(
      input,
      qojHomeUrl(),
      cookie,
      input.account.authMode === "browser-session",
    );
    if (isQOJCloudflarePage(response.text) || response.status === 403)
      throw failure(input, "blocked", "identity", response.status);
    if (response.status === 429)
      throw failure(input, "rate_limited", "identity", response.status);
    if (response.status === 401 || isQOJLoginPage(response.text, response.url))
      throw failure(input, "auth_required", "identity", response.status);
    if (response.status < 200 || response.status >= 300)
      throw failure(input, "network", "identity", response.status);
    const username = parseQOJIdentity(response.text);
    if (!username)
      throw failure(input, "parse_failed", "identity", response.status);
    return {
      accountId: input.account.accountId,
      source: "qoj",
      providerAccountKey: username,
      displayName: username,
    };
  },
  metadata: {
    id: "qoj",
    displayName: "QOJ",
    availability: "experimental",
    authModes: [
      {
        type: "browser-session",
        recommended: true,
      },
      {
        type: "manual-cookie",
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
      if (input.signal.aborted) throw input.signal.reason;
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
    reportProgress(input.onProgress, {
      phase: "identity",
      pagesFetched: 0,
      recordsFetched: 0,
    });
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
      if (identityResponse.status === 429)
        throw failure(
          input,
          "rate_limited",
          "identity",
          identityResponse.status,
        );
      if (identityResponse.status < 200 || identityResponse.status >= 300)
        throw failure(input, "network", "identity", identityResponse.status);
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
    const records: Submission[] = [];
    let page = 1;
    const reasons: PartialReason[] = [];
    const diagnostics: Diagnostic[] = [];
    let pagesFetched = 0;
    let successfulPages = 0;
    let evidence: "exhausted" | "window-boundary" = "exhausted";
    let ordered = true;
    let previousOldest = Infinity;
    const seenPageKeys = new Set<string>();
    const seenRecords = new Set<string>();
    while (records.length < limit && page <= 100) {
      try {
        const listUrl = qojSubmissionListUrl(username, page);
        const response = await input.pagination.runPage({
          origin: "https://qoj.ac",
          signal: input.signal,
          request: () => {
            pagesFetched += 1;
            reportProgress(input.onProgress, {
              phase: "list",
              pagesFetched,
              recordsFetched: records.length,
            });
            return request(
              input,
              listUrl,
              manualCookie,
              input.account.authMode === "browser-session",
            );
          },
        });
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
        let pageRecords: Submission[];
        try {
          pageRecords = parsed.records.map((raw) =>
            normalizeQOJRecord(
              raw,
              input.account.accountId,
              username,
              input.now,
            ),
          );
        } catch {
          throw failure(input, "parse_failed", "parse", response.status);
        }
        successfulPages += 1;
        const pageKey = pageRecords
          .map((record) => record.submissionId)
          .join(",");
        if (pageKey && seenPageKeys.has(pageKey)) {
          reasons.push("pagination-repeated");
          break;
        }
        if (pageKey) seenPageKeys.add(pageKey);
        const validTimes = pageRecords.every(
          (record) =>
            Number.isSafeInteger(record.submittedAt) && record.submittedAt >= 0,
        );
        // QOJ submissions are listed in descending submission order; validate
        // normalized timestamps across pages before using the lower boundary.
        ordered =
          ordered &&
          validTimes &&
          pageRecords.every(
            (record, index) =>
              record.submittedAt <=
              (index === 0
                ? previousOldest
                : pageRecords[index - 1]!.submittedAt),
          );
        if (pageRecords.length > 0)
          previousOldest = pageRecords[pageRecords.length - 1]!.submittedAt;
        if (!validTimes) reasons.push("invalid-record");
        for (const record of pageRecords) {
          if (
            !isWithinSyncWindow(record.submittedAt, input) ||
            seenRecords.has(record.submissionId)
          )
            continue;
          seenRecords.add(record.submissionId);
          if (records.length < limit) records.push(record);
          else reasons.push("record-limit");
        }
        reportProgress(input.onProgress, {
          phase: "list",
          pagesFetched,
          recordsFetched: records.length,
        });
        const reachedSince =
          ordered &&
          pageRecords.some((record) => record.submittedAt < input.since);
        if (!parsed.hasMore) break;
        if (parsed.records.length === 0) {
          reasons.push("unverified-coverage");
          break;
        }
        if (reachedSince) {
          evidence = "window-boundary";
          break;
        }
        if (records.length >= limit) {
          reasons.push("record-limit");
          break;
        }
        if (page >= 100) {
          reasons.push("page-limit");
          break;
        }
        page += 1;
      } catch (error) {
        if (input.signal.aborted && !isCollectionDeadline(input.signal))
          throw input.signal.reason;
        if (successfulPages > 0 && isCollectionDeadline(input.signal)) {
          reasons.push("deadline");
          diagnostics.push({
            source: "qoj",
            code: "deadline",
            severity: "warning",
            messageKey: "sync.partial",
            retryable: true,
          });
          break;
        }
        if (
          successfulPages === 0 ||
          !(error instanceof AdapterFailure) ||
          error.error.stage === "identity" ||
          error.error.kind === "auth_required" ||
          error.error.kind === "unknown"
        )
          throw error;
        const reason: PartialReason = isCollectionDeadline(input.signal)
          ? "deadline"
          : error.error.kind === "rate_limited"
            ? "rate-limited"
            : "unavailable";
        reasons.push(reason);
        diagnostics.push({
          source: "qoj",
          code: reason,
          severity: "warning",
          messageKey: error.error.messageKey,
          retryable: error.error.retryable,
        });
        break;
      }
    }
    const coverage = finalizeCoverage(
      input,
      pagesFetched,
      records.length,
      reasons.length
        ? { status: "partial", reasons: [reasons[0]!, ...reasons.slice(1)] }
        : { status: "complete", evidence },
    );
    return {
      account: {
        accountId: input.account.accountId,
        source: "qoj" as const,
        providerAccountKey: username,
        displayName: username,
      },
      records,
      diagnostics,
      coverage,
    };
  },
};
