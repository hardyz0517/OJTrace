import type { FetchInput, OJAdapter } from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { normalizeAtCoderSubmission } from "./normalizer";
import {
  parseAtCoderProblems,
  parseAtCoderSubmissionDetails,
  parseAtCoderSubmissions,
} from "./parser";
import {
  atcoderHomeUrl,
  atcoderProblemsUrl,
  atcoderSubmissionDetailUrl,
  atcoderUserSubmissionsUrl,
} from "./urls";

function atcoderSessionCookie(raw: string): string {
  const value = raw.trim();
  if (!value || /[\r\n]/.test(value)) {
    throw new Error("AtCoder session credential is invalid");
  }
  return value.startsWith("REVEL_SESSION=") ? value : `REVEL_SESSION=${value}`;
}

function manualAtCoderCookie(
  account: FetchInput["account"],
): string | undefined {
  const value =
    account.credentials?.REVEL_SESSION?.trim() ?? account.cookie?.trim();
  return value ? atcoderSessionCookie(value) : undefined;
}

function parseAtCoderUsername(text: string): string | undefined {
  return (
    text.match(/window\.userScreenName\s*=\s*["']([^"']+)["']/i)?.[1] ??
    text.match(
      /(?:userScreenName|user_name|username)\s*[:=]\s*["']([^"']+)["']/i,
    )?.[1] ??
    text
      .match(
        /Welcome,\s*(?:<[^>]+>\s*)?([^<.!?]+?)(?:\s*<\/[^>]+>)?[.!<]/i,
      )?.[1]
      ?.trim()
  );
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export const atcoderAdapter: OJAdapter = {
  metadata: {
    id: "atcoder",
    displayName: "AtCoder",
    availability: "stable",
    dataOrigins: ["https://kenkoooo.com/*", "https://atcoder.jp/*"],
    authModes: [
      {
        type: "browser-session",
        recommended: true,
        label: "使用当前浏览器登录状态",
        description:
          "使用当前浏览器中已经登录的 AtCoder 账号，无需手动复制 Cookie。",
      },
      {
        type: "manual-cookie",
        label: "手动配置",
        description:
          "浏览器登录态无法检测时，仅使用 REVEL_SESSION 配置；账号 Handle 会从登录态自动识别。",
        credentialFields: [
          {
            key: "REVEL_SESSION",
            label: "REVEL_SESSION",
            type: "password",
            placeholder: "粘贴 REVEL_SESSION 值",
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
  async detectBrowserSession(input) {
    // A page-context identity is authoritative for this check. Extension
    // service-worker fetches do not consistently share the browser tab's
    // session cookie in Chrome and Edge.
    const pageIdentity = input.pageIdentity?.trim();
    if (pageIdentity && !/\s/.test(pageIdentity)) {
      return {
        authenticated: true,
        status: "authenticated",
        username: pageIdentity,
      };
    }
    try {
      const response = await input.http.request("atcoder", atcoderHomeUrl(), {
        credentials: "include",
        signal: input.signal,
        headers: { Accept: "text/html" },
      });
      if (response.status < 200 || response.status >= 300)
        return {
          authenticated: false,
          status: response.status === 403 ? "permission-denied" : "site-error",
        };
      if (
        /Sign In|ログイン|login\?continue/i.test(response.text) &&
        !pageIdentity
      )
        return { authenticated: false, status: "unauthenticated" };
      const logoutLink = /(?:href|action)=["'][^"']*logout[^"']*["']/i.test(
        response.text,
      );
      const username = pageIdentity ?? parseAtCoderUsername(response.text);
      const authenticatedMarker =
        username ||
        logoutLink ||
        /(?:ログアウト|Sign\s*out|logout|user-menu|navbar-user)/i.test(
          response.text,
        );
      return authenticatedMarker
        ? {
            authenticated: true,
            status: "authenticated",
            ...(username ? { username } : {}),
          }
        : { authenticated: false, status: "site-error" };
    } catch {
      return { authenticated: false, status: "network-error" };
    }
  },
  async fetchRecent(input) {
    const authMode = input.account.authMode;
    if (authMode !== "browser-session" && authMode !== "manual-cookie") {
      throw new AdapterFailure({
        kind: "unsupported",
        source: "atcoder",
        stage: "identity",
        messageKey: "account.authModeUnsupported",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    const manualCookie = manualAtCoderCookie(input.account);
    if (authMode === "manual-cookie" && !manualCookie) {
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "atcoder",
        stage: "identity",
        messageKey: "account.cookieRequired",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    let handle = input.account.identifier.trim();
    if (authMode === "manual-cookie" && !handle && manualCookie) {
      try {
        const identityResponse = await input.http.request(
          "atcoder",
          atcoderHomeUrl(),
          {
            credentials: "omit",
            headers: { Accept: "text/html" },
            atcoderSessionCookie: manualCookie,
            signal: input.signal,
          },
        );
        if (
          identityResponse.status < 200 ||
          identityResponse.status >= 300 ||
          /Sign In|ログイン|login\?continue/i.test(identityResponse.text)
        ) {
          throw new AdapterFailure({
            kind: "auth_required",
            source: "atcoder",
            stage: "identity",
            messageKey: "source.authRequired",
            retryable: false,
            userAction: "open_site_login",
            httpStatus: identityResponse.status,
            requestId: input.requestId,
          });
        }
        handle = parseAtCoderUsername(identityResponse.text) ?? "";
      } catch (error) {
        if (error instanceof AdapterFailure) throw error;
        throw AdapterFailure.fromTransport(error, "atcoder", input.requestId);
      }
    }
    if (!handle)
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "atcoder",
        stage: "identity",
        messageKey: "account.identityFromCookieRequired",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    let response;
    try {
      response = await input.http.request(
        "atcoder",
        atcoderUserSubmissionsUrl(handle),
        {
          // AtCoder Problems is a public cross-origin API. Sending browser
          // credentials here triggers CORS failures because it uses a
          // wildcard Access-Control-Allow-Origin header, and it is not needed
          // for public submission data.
          credentials: "omit",
          atcoderProblemsApi: true,
          signal: input.signal,
          headers: {
            Accept: "application/json",
          },
        },
      );
    } catch (error) {
      throw AdapterFailure.fromTransport(error, "atcoder", input.requestId);
    }
    if (
      response.status === 401 ||
      /Sign In|ログイン|login\?continue/i.test(response.text)
    )
      throw new AdapterFailure({
        kind: "auth_required",
        source: "atcoder",
        stage: "request",
        messageKey: "source.authRequired",
        retryable: false,
        userAction: "open_site_login",
        httpStatus: response.status,
        requestId: input.requestId,
      });
    if (response.status === 403 || response.status === 429)
      throw new AdapterFailure({
        kind: response.status === 403 ? "blocked" : "rate_limited",
        source: "atcoder",
        stage: "request",
        messageKey:
          response.status === 403 ? "source.blocked" : "source.rateLimited",
        retryable: response.status >= 500,
        userAction: "retry_later",
        httpStatus: response.status,
        requestId: input.requestId,
      });
    if (response.status < 200 || response.status >= 300)
      throw new AdapterFailure({
        kind: "network",
        source: "atcoder",
        stage: "request",
        messageKey: "source.httpError",
        retryable: response.status >= 500,
        httpStatus: response.status,
        requestId: input.requestId,
      });
    let raw;
    try {
      raw = parseAtCoderSubmissions(response.text);
    } catch {
      throw new AdapterFailure({
        kind: "parse_failed",
        source: "atcoder",
        stage: "parse",
        messageKey: "source.invalidResponse",
        retryable: false,
        requestId: input.requestId,
      });
    }
    let problemNames = new Map<string, string>();
    try {
      const metadata = await input.http.request(
        "atcoder",
        atcoderProblemsUrl(),
        {
          atcoderProblemMetadataApi: true,
          credentials: "omit",
          signal: input.signal,
          headers: { Accept: "application/json" },
        },
      );
      if (metadata.status >= 200 && metadata.status < 300) {
        problemNames = new Map(
          parseAtCoderProblems(metadata.text).flatMap((problem) => {
            const name = problem.title ?? problem.name;
            return name ? [[problem.id, name] as const] : [];
          }),
        );
      }
    } catch {
      // Metadata is optional; records remain usable with problem IDs.
    }
    const rows = raw.slice(0, Math.min(input.limit, 100));
    const details = await mapConcurrent(rows, 4, async (item) => {
      try {
        const page = await input.http.request(
          "atcoder",
          atcoderSubmissionDetailUrl(item.contestId, item.id),
          {
            atcoderSubmissionPage: true,
            credentials: "omit",
            timeoutMs: 5_000,
            signal: input.signal,
            headers: { Accept: "text/html" },
          },
        );
        return page.status >= 200 && page.status < 300
          ? parseAtCoderSubmissionDetails(page.text)
          : {};
      } catch {
        return {};
      }
    });
    const records = rows.map((item, index) =>
      normalizeAtCoderSubmission(
        { ...item, ...details[index] },
        input.account.accountId,
        handle,
        input.now,
        problemNames.get(item.problemId),
      ),
    );
    return {
      account: {
        accountId: input.account.accountId,
        source: "atcoder",
        providerAccountKey: handle,
        displayName: handle,
      },
      records,
      diagnostics: [],
      hasMore: raw.length > records.length,
    };
  },
};

export {
  atcoderProblemUrl,
  atcoderSubmissionUrl,
  atcoderUserSubmissionsUrl,
  atcoderUserUrl,
  atcoderHomeUrl,
  atcoderProblemsUrl,
  atcoderSubmissionDetailUrl,
} from "./urls";
export {
  parseAtCoderProblems,
  parseAtCoderSubmissionDetails,
  parseAtCoderSubmissions,
} from "./parser";
export { normalizeAtCoderSubmission } from "./normalizer";
