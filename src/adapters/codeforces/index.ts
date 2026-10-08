import { finalizeCoverage } from "../shared/submission-window";
import {
  cookieHeaderFromCredentials,
  credentialValue,
  type BrowserSessionAccount,
  type BrowserSessionInput,
  type FetchInput,
  type OJAdapter,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { reportProgress } from "../../domain/sync-progress";
import { normalizeCodeforcesSubmission } from "./normalizer";
import { parseCodeforcesResponse } from "./parser";

const CODEFORCES_HOME_URL = "https://codeforces.com/";

function isCodeforcesChallenge(text: string, headers: Headers): boolean {
  return (
    headers.get("cf-mitigated")?.toLowerCase() === "challenge" ||
    /<title\b[^>]*>\s*(?:just a moment(?:\.{3}|…)?|attention required!?(?:\s*\|\s*cloudflare)?)\s*<\/title>/i.test(
      text,
    ) ||
    /(?:window\.)?_cf_chl_opt\s*=/.test(text)
  );
}

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
  trace?: (diagnostic: string) => void,
) {
  const identityMessageKey = cookie
    ? "account.identityFromCookieRequired"
    : "source.authRequired";
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
    if (input.signal.aborted) throw input.signal.reason;
    throw AdapterFailure.fromTransport(error, "codeforces", input.requestId);
  }
  trace?.(`http=${response.status}`);
  if (isCodeforcesChallenge(response.text, response.headers)) {
    trace?.("codeforces-cloudflare-challenge");
    throw new AdapterFailure({
      kind: "blocked",
      source: "codeforces",
      stage: "identity",
      messageKey: "source.blocked",
      retryable: false,
      userAction: "open_site_login",
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  if (response.status === 401) {
    trace?.("codeforces-login-required");
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
    trace?.("codeforces-forbidden");
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
    trace?.("codeforces-rate-limited");
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
    trace?.("codeforces-http-error");
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
  if (isCodeforcesLoginPage(response.text)) {
    trace?.("codeforces-login-required");
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
  const username = parseCodeforcesUsername(response.text);
  if (!username) {
    trace?.("codeforces-identity-missing");
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
  async authorize(input) {
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
        requestId: input.requestId,
      });
    }
    let username: string;
    if (authMode === "public-handle") {
      const handle = (
        input.account.identifier ??
        input.account.providerAccountKey ??
        ""
      ).trim();
      if (!handle)
        throw new AdapterFailure({
          kind: "invalid_response",
          source: "codeforces",
          stage: "identity",
          messageKey: "account.identifierRequired",
          retryable: false,
          requestId: input.requestId,
        });
      let response;
      try {
        response = await input.http.request(
          "codeforces",
          `https://codeforces.com/api/user.info?handles=${encodeURIComponent(handle)}`,
          codeforcesRequestOptions("public-handle", input.signal),
        );
      } catch (error) {
        if (input.signal.aborted) throw input.signal.reason;
        throw AdapterFailure.fromTransport(
          error,
          "codeforces",
          input.requestId,
        );
      }
      if (response.status < 200 || response.status >= 300)
        throw new AdapterFailure({
          kind:
            response.status === 429
              ? "rate_limited"
              : response.status === 403
                ? "blocked"
                : "network",
          source: "codeforces",
          stage: "identity",
          messageKey:
            response.status === 429 ? "source.rateLimited" : "source.httpError",
          retryable: response.status >= 500,
          httpStatus: response.status,
          requestId: input.requestId,
        });
      let parsed: { status?: unknown; result?: Array<{ handle?: unknown }> };
      try {
        parsed = JSON.parse(response.text) as typeof parsed;
      } catch {
        throw new AdapterFailure({
          kind: "parse_failed",
          source: "codeforces",
          stage: "identity",
          messageKey: "source.invalidResponse",
          retryable: false,
          requestId: input.requestId,
        });
      }
      const resolved = Array.isArray(parsed.result)
        ? parsed.result[0]?.handle
        : undefined;
      if (
        parsed.status !== "OK" ||
        typeof resolved !== "string" ||
        !resolved.trim()
      )
        throw new AdapterFailure({
          kind: "invalid_response",
          source: "codeforces",
          stage: "identity",
          messageKey: "account.notFound",
          retryable: false,
          userAction: "edit_account",
          requestId: input.requestId,
        });
      username = resolved;
    } else {
      const cookie =
        authMode === "manual-cookie"
          ? manualCodeforcesCookie(input.credentials)
          : undefined;
      if (authMode === "manual-cookie" && !cookie)
        throw new AdapterFailure({
          kind: "invalid_response",
          source: "codeforces",
          stage: "identity",
          messageKey: "account.cookieRequired",
          retryable: false,
          requestId: input.requestId,
        });
      username = await currentCodeforcesUser(input, cookie);
    }
    return {
      accountId: input.account.accountId,
      source: "codeforces",
      providerAccountKey: username,
      displayName: username,
    };
  },
  metadata: {
    id: "codeforces",
    displayName: "Codeforces",
    availability: "stable",
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
  },

  async detectBrowserSession(input: BrowserSessionInput) {
    const trace: string[] = [];
    const failed = (
      status: BrowserSessionAccount["status"],
    ): BrowserSessionAccount => ({
      authenticated: false,
      status,
      diagnostic: [
        "codeforces-session",
        ...trace,
        `requestId=${input.requestId}`,
      ].join("; "),
    });
    if (input.http.getCookieMetadata) {
      try {
        const cookies = await input.http.getCookieMetadata(
          "codeforces",
          CODEFORCES_HOME_URL,
        );
        const sessions = cookies.filter(
          (cookie) => cookie.name === "JSESSIONID",
        );
        // getAll() filters non-Secure cookies against HTTP host permissions,
        // even when queried with an HTTPS URL. This is visibility, not login.
        trace.push(`jsessionid-visible-count=${sessions.length}`);
        for (const cookie of sessions) {
          trace.push(
            `session-scope=${cookie.domain}${cookie.path},hostOnly=${cookie.hostOnly},sameSite=${cookie.sameSite}`,
          );
        }
        trace.push(
          `clearance-unpartitioned=${cookies.some((cookie) => cookie.name === "cf_clearance" && !cookie.partitionTopLevelSite)}`,
        );
        trace.push(
          `clearance-first-party-partitioned=${cookies.some((cookie) => cookie.name === "cf_clearance" && cookie.partitionTopLevelSite === "https://codeforces.com")}`,
        );
      } catch {
        if (input.signal.aborted) throw input.signal.reason;
        // Cookie inspection is optional and must not prevent the real request.
        trace.push("cookie-metadata-read-failed");
      }
    }
    try {
      const username = await currentCodeforcesUser(
        input,
        undefined,
        (diagnostic) => trace.push(diagnostic),
      );
      return {
        authenticated: true,
        status: "authenticated" as const,
        username,
      };
    } catch (error) {
      if (input.signal.aborted) throw input.signal.reason;
      if (!(error instanceof AdapterFailure)) {
        trace.push("codeforces-unexpected-error");
        return failed("site-error");
      }
      trace.push(
        `kind=${error.error.kind}`,
        `stage=${error.error.stage}`,
        `key=${error.error.messageKey}`,
      );
      switch (error.error.kind) {
        case "auth_required":
          return failed("unauthenticated");
        case "network":
        case "timeout":
          return failed("network-error");
        case "rate_limited":
          trace.push("codeforces-rate-limited");
          return failed("site-error");
        default:
          return failed("site-error");
      }
    }
  },

  async fetchRecent(input: FetchInput) {
    reportProgress(input.onProgress, {
      phase: "identity",
      pagesFetched: 0,
      recordsFetched: 0,
    });
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
        if (input.signal.aborted) throw input.signal.reason;
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
      response = await input.pagination.runPage({
        origin: "https://codeforces.com",
        signal: input.signal,
        request: () => {
          reportProgress(input.onProgress, {
            phase: "list",
            pagesFetched: 1,
            recordsFetched: 0,
          });
          return input.http.request(
            "codeforces",
            `https://codeforces.com/api/user.status?handle=${encodeURIComponent(resolvedHandle)}&from=1&count=1000`,
            codeforcesRequestOptions(authMode, input.signal),
          );
        },
      });
    } catch (error) {
      if (input.signal.aborted) throw input.signal.reason;
      if (error instanceof AdapterFailure) throw error;
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
    let normalized;
    let records;
    try {
      normalized = (parsed.result ?? []).map((item) =>
        normalizeCodeforcesSubmission(
          item,
          input.account.accountId,
          resolvedHandle,
          input.now,
        ),
      );
      records = [
        ...new Map(
          normalized
            .filter(
              (item) =>
                Number.isSafeInteger(item.submittedAt) &&
                item.submittedAt >= 0 &&
                item.submittedAt >= input.since &&
                item.submittedAt <= input.until,
            )
            .map((record) => [record.submissionId, record]),
        ).values(),
      ];
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
    const truncated = records.length > Math.max(1, Math.min(input.limit, 1000));
    records = records.slice(0, Math.max(1, Math.min(input.limit, 1000)));
    reportProgress(input.onProgress, {
      phase: "list",
      pagesFetched: 1,
      recordsFetched: records.length,
    });
    const exhausted = (parsed.result ?? []).length < 1000;
    // Official user.status is newest-first; validate the returned sequence.
    const boundary =
      normalized.every(
        (record, index) =>
          Number.isSafeInteger(record.submittedAt) &&
          record.submittedAt >= 0 &&
          (index === 0 ||
            record.submittedAt <= normalized[index - 1]!.submittedAt),
      ) && normalized.some((record) => record.submittedAt < input.since);
    const invalidTimes = normalized.some(
      (record) =>
        !Number.isSafeInteger(record.submittedAt) || record.submittedAt < 0,
    );
    const coverage = finalizeCoverage(
      input,
      1,
      records.length,
      !invalidTimes && !truncated && (exhausted || boundary)
        ? {
            status: "complete",
            evidence: boundary ? "window-boundary" : "exhausted",
          }
        : {
            status: "partial",
            reasons: invalidTimes ? ["invalid-record"] : ["record-limit"],
          },
    );
    return {
      account: {
        accountId: input.account.accountId,
        source: "codeforces",
        providerAccountKey: resolvedHandle,
        displayName: resolvedHandle,
      },
      records,
      diagnostics: [],
      coverage,
    };
  },
};

export { codeforcesListUrl } from "./urls";
