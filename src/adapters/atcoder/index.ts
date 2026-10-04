import { finalizeCoverage } from "../shared/submission-window";
import {
  credentialValue,
  type OJAdapter,
  type AuthorizeInput,
  type Diagnostic,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { reportProgress } from "../../domain/sync-progress";
import { normalizeAtCoderSubmission } from "./normalizer";
import { parseAtCoderProblems, parseAtCoderSubmissionDetails } from "./parser";
import {
  atcoderHomeUrl,
  atcoderProblemsUrl,
  atcoderSubmissionDetailUrl,
} from "./urls";
import { collectAtCoderSubmissions } from "./submissions";

function atcoderSessionCookie(raw: string): string {
  const value = raw.trim();
  if (!value || /[\r\n]/.test(value)) {
    throw new Error("AtCoder session credential is invalid");
  }
  return value.startsWith("REVEL_SESSION=") ? value : `REVEL_SESSION=${value}`;
}

function manualAtCoderCookie(
  credentials: Record<string, string> | undefined,
): string | undefined {
  const value = credentialValue(credentials, "REVEL_SESSION");
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
  const results: R[] = [];
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

async function resolveAtCoderHandle(
  input: AuthorizeInput,
  verify = false,
): Promise<string> {
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
  const manualCookie = manualAtCoderCookie(input.credentials);
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
  let handle = (
    input.account.providerAccountKey ??
    input.account.identifier ??
    ""
  ).trim();
  if (verify || !handle) {
    try {
      const identityResponse = await input.http.request(
        "atcoder",
        atcoderHomeUrl(),
        {
          credentials: authMode === "browser-session" ? "include" : "omit",
          headers: { Accept: "text/html" },
          ...(manualCookie ? { atcoderSessionCookie: manualCookie } : {}),
          signal: input.signal,
        },
      );
      if (identityResponse.status === 429 || identityResponse.status === 403)
        throw new AdapterFailure({
          kind: identityResponse.status === 429 ? "rate_limited" : "blocked",
          source: "atcoder",
          stage: "identity",
          messageKey:
            identityResponse.status === 429
              ? "source.rateLimited"
              : "source.blocked",
          retryable: false,
          httpStatus: identityResponse.status,
          requestId: input.requestId,
        });
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
      if (input.signal.aborted) throw input.signal.reason;
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
  return handle;
}

export const atcoderAdapter: OJAdapter = {
  async authorize(input) {
    const handle = await resolveAtCoderHandle(input, true);
    return {
      accountId: input.account.accountId,
      source: "atcoder",
      providerAccountKey: handle,
      displayName: handle,
    };
  },
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
            credentialType: "cookie",
            placeholder: "粘贴 REVEL_SESSION 值",
          },
        ],
        identifierRequired: false,
      },
    ],
  },
  async detectBrowserSession(input) {
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
      if (/Sign In|ログイン|login\?continue/i.test(response.text))
        return { authenticated: false, status: "unauthenticated" };
      const logoutLink = /(?:href|action)=["'][^"']*logout[^"']*["']/i.test(
        response.text,
      );
      const username = parseAtCoderUsername(response.text);
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
    reportProgress(input.onProgress, {
      phase: "identity",
      pagesFetched: 0,
      recordsFetched: 0,
    });
    const handle = await resolveAtCoderHandle(input);
    const { rows, pagesFetched, outcome } = await collectAtCoderSubmissions(
      input,
      handle,
    );
    const diagnostics: Diagnostic[] = [];
    let enrichmentStopped = false;
    let enrichmentIncomplete = false;
    let problemNames = new Map<string, string>();
    if (rows.length > 0)
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
        if (metadata.status < 200 || metadata.status >= 300)
          enrichmentIncomplete = true;
        if (metadata.status >= 200 && metadata.status < 300) {
          problemNames = new Map(
            parseAtCoderProblems(metadata.text).flatMap((problem) => {
              const name = problem.title ?? problem.name;
              return name ? [[problem.id, name] as const] : [];
            }),
          );
        }
      } catch {
        enrichmentIncomplete = true;
        // Metadata is optional; records remain usable with problem IDs.
      }
    let detailsCompleted = 0;
    reportProgress(input.onProgress, {
      phase: "details",
      pagesFetched,
      recordsFetched: rows.length,
      detailsTotal: rows.length,
      detailsCompleted,
    });
    const details = await mapConcurrent(rows, 4, async (item) => {
      if (enrichmentStopped || input.signal.aborted) return {};
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
        if (page.status === 429) enrichmentStopped = true;
        if (page.status < 200 || page.status >= 300)
          enrichmentIncomplete = true;
        return page.status >= 200 && page.status < 300
          ? parseAtCoderSubmissionDetails(page.text)
          : {};
      } catch (error) {
        enrichmentIncomplete = true;
        if (
          input.signal.aborted ||
          (error instanceof Error &&
            "code" in error &&
            error.code === "rate_limited")
        )
          enrichmentStopped = true;
        return {};
      } finally {
        detailsCompleted += 1;
        reportProgress(input.onProgress, {
          phase: "details",
          pagesFetched,
          recordsFetched: rows.length,
          detailsTotal: rows.length,
          detailsCompleted,
        });
      }
    });
    if (
      input.signal.aborted &&
      (input.signal.reason as { kind?: string } | undefined)?.kind !==
        "deadline"
    )
      throw input.signal.reason;
    if (enrichmentStopped || enrichmentIncomplete || input.signal.aborted)
      diagnostics.push({
        source: "atcoder",
        code: "enrichment-incomplete",
        severity: "warning",
        messageKey: "sync.enrichmentIncomplete",
        retryable: true,
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
    const coverage = finalizeCoverage(
      input,
      pagesFetched,
      records.length,
      outcome,
    );
    return {
      account: {
        accountId: input.account.accountId,
        source: "atcoder",
        providerAccountKey: handle,
        displayName: handle,
      },
      records,
      diagnostics,
      coverage,
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
