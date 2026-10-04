import {
  finalizeCoverage,
  isCollectionDeadline,
} from "../shared/submission-window";
import { isWithinSyncWindow } from "../../domain/sync-range";
import {
  cookieHeaderFromCredentials,
  type BrowserSessionInput,
  type PartialReason,
  type AuthorizeInput,
  type Diagnostic,
  type FetchInput,
  type OJAdapter,
  type Submission,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { reportProgress } from "../../domain/sync-progress";
import { normalizeLuoguRecord } from "./normalizer";
import { parseLuoguDocument, parseLuoguIdentityDocument } from "./parser";
import { luoguRecordListUrl, luoguUserSettingUrl } from "./urls";

function isAuthResponse(response: { status: number; text: string }): boolean {
  return (
    response.status === 401 ||
    /UserUnloginException|"errorCode"\s*:\s*401|请先登录|login required/i.test(
      (response.text ?? "").slice(0, 20_000),
    )
  );
}

function requestOptions(
  authMode: "browser-session" | "manual-cookie",
  cookie?: string,
) {
  return {
    headers: {
      Accept: "application/json,text/html,application/xhtml+xml;q=0.9",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    credentials:
      authMode === "browser-session" ? ("include" as const) : ("omit" as const),
  };
}

function manualLuoguCookie(
  credentials: Record<string, string> | undefined,
): string | undefined {
  return cookieHeaderFromCredentials(credentials, ["__client_id", "_uid"]);
}

async function requestLuogu(
  input: Pick<FetchInput, "signal" | "requestId" | "http">,
  url: string,
  authMode: "browser-session" | "manual-cookie" = "browser-session",
  cookie?: string,
) {
  try {
    return await input.http.request("luogu", url, {
      ...requestOptions(authMode, cookie),
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason;
    throw AdapterFailure.fromTransport(error, "luogu", input.requestId);
  }
}

async function currentLuoguUser(input: BrowserSessionInput, cookie?: string) {
  const response = await requestLuogu(
    input,
    luoguUserSettingUrl(),
    cookie ? "manual-cookie" : "browser-session",
    cookie,
  );
  if (isAuthResponse(response)) {
    throw new AdapterFailure({
      kind: "auth_required",
      source: "luogu",
      stage: "identity",
      messageKey: "source.authRequired",
      retryable: false,
      userAction: "open_site_login",
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  if (response.status === 403) {
    throw new AdapterFailure({
      kind: "blocked",
      source: "luogu",
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
      source: "luogu",
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
      source: "luogu",
      stage: "identity",
      messageKey: "source.httpError",
      retryable: response.status >= 500,
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  try {
    return parseLuoguIdentityDocument(response.text, response.contentType);
  } catch {
    throw new AdapterFailure({
      kind: "parse_failed",
      source: "luogu",
      stage: "identity",
      messageKey: "source.invalidResponse",
      retryable: false,
      requestId: input.requestId,
    });
  }
}

export const luoguAdapter: OJAdapter = {
  async authorize(input: AuthorizeInput) {
    const cookie =
      input.account.authMode === "manual-cookie"
        ? manualLuoguCookie(input.credentials)
        : undefined;
    if (input.account.authMode === "manual-cookie" && !cookie)
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "luogu",
        stage: "identity",
        messageKey: "account.cookieRequired",
        retryable: false,
        requestId: input.requestId,
      });
    if (
      input.account.authMode !== "manual-cookie" &&
      input.account.authMode !== "browser-session"
    )
      throw new AdapterFailure({
        kind: "unsupported",
        source: "luogu",
        stage: "identity",
        messageKey: "account.authModeUnsupported",
        retryable: false,
        requestId: input.requestId,
      });
    const user = await currentLuoguUser(input, cookie);
    return {
      accountId: input.account.accountId,
      source: "luogu",
      providerAccountKey: String(user.uid ?? user.name),
      displayName: user.name,
    };
  },
  metadata: {
    id: "luogu",
    displayName: "洛谷",
    availability: "stable",
    authModes: [
      {
        type: "browser-session",
        recommended: true,
        label: "使用当前浏览器登录状态",
        description:
          "使用当前浏览器中已经登录的洛谷账号，无需手动复制 Cookie。",
      },
      {
        type: "manual-cookie",
        label: "手动配置",
        description:
          "自动检测失败时，分别填写洛谷的 __client_id 和 _uid Cookie 值。",
        credentialFields: [
          {
            key: "__client_id",
            label: "__client_id",
            type: "password",
            credentialType: "cookie",
            placeholder: "粘贴 __client_id 的值",
            required: true,
          },
          {
            key: "_uid",
            label: "_uid",
            type: "password",
            credentialType: "cookie",
            placeholder: "粘贴 _uid 的值",
            required: true,
          },
        ],
        identifierRequired: false,
      },
    ],
  },

  async detectBrowserSession(input) {
    try {
      const user = await currentLuoguUser(input);
      return {
        authenticated: true,
        status: "authenticated",
        ...(user.name ? { username: user.name } : {}),
        ...(user.uid !== undefined ? { uid: String(user.uid) } : {}),
      };
    } catch (error) {
      if (input.signal.aborted) throw input.signal.reason;
      if (!(error instanceof AdapterFailure)) {
        return { authenticated: false, status: "site-error" };
      }
      switch (error.error.kind) {
        case "auth_required":
          return { authenticated: false, status: "unauthenticated" };
        case "network":
        case "timeout":
          return { authenticated: false, status: "network-error" };
        default:
          return { authenticated: false, status: "site-error" };
      }
    }
  },

  async fetchRecent(input) {
    reportProgress(input.onProgress, {
      phase: "identity",
      pagesFetched: 0,
      recordsFetched: 0,
    });
    const authMode = input.account.authMode;
    if (authMode !== "browser-session" && authMode !== "manual-cookie") {
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "luogu",
        stage: "identity",
        messageKey: "account.authModeUnsupported",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    const manualCookie = manualLuoguCookie(input.credentials);
    if (authMode === "manual-cookie" && !manualCookie) {
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "luogu",
        stage: "identity",
        messageKey: "account.cookieRequired",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    let identifier = (
      input.account.providerAccountKey ??
      input.account.identifier ??
      ""
    ).trim();
    if (!identifier && manualCookie) {
      const uid = manualCookie.match(/(?:^|;\s*)_uid=([^;]+)/)?.[1]?.trim();
      if (uid) identifier = decodeURIComponent(uid);
    }
    const identity =
      authMode === "browser-session" && !identifier
        ? await currentLuoguUser(input)
        : undefined;
    if (!identifier) {
      identifier = String(identity?.uid ?? identity?.name ?? "");
    }
    if (!identifier) {
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "luogu",
        stage: "identity",
        messageKey: "account.identifierRequired",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    }
    const maxRecords = Math.max(1, Math.min(input.limit, 1_000));
    const maxPages = 100;
    const records: Submission[] = [];
    let providerUser = identity;
    let page = 1;
    const reasons: PartialReason[] = [];
    const diagnostics: Diagnostic[] = [];
    let pagesFetched = 0;
    let pageEstimate: number | undefined;
    let successfulPages = 0;
    const rawRecordIds = new Set<string>();
    let evidence: "exhausted" | "window-boundary" = "exhausted";
    let ordered = true;
    let previousOldest = Infinity;
    const seenRecords = new Set<string>();
    const seenPageKeys = new Set<string>();

    while (true) {
      try {
        const response = await input.pagination.runPage({
          origin: "https://www.luogu.com.cn",
          signal: input.signal,
          request: () => {
            pagesFetched += 1;
            reportProgress(input.onProgress, {
              phase: "list",
              pagesFetched,
              recordsFetched: records.length,
              pageEstimate,
            });
            return requestLuogu(
              input,
              luoguRecordListUrl(identifier, page),
              authMode,
              manualCookie,
            );
          },
        });
        if (isAuthResponse(response)) {
          throw new AdapterFailure({
            kind: "auth_required",
            source: "luogu",
            stage: "request",
            messageKey: "source.authRequired",
            retryable: false,
            userAction: "open_site_login",
            httpStatus: response.status,
            requestId: input.requestId,
          });
        }
        if (response.status === 403) {
          throw new AdapterFailure({
            kind: "blocked",
            source: "luogu",
            stage: "request",
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
            source: "luogu",
            stage: "request",
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
            source: "luogu",
            stage: "request",
            messageKey: "source.httpError",
            retryable: response.status >= 500,
            httpStatus: response.status,
            requestId: input.requestId,
          });
        }
        let parsed;
        try {
          parsed = parseLuoguDocument(response.text, response.contentType);
        } catch {
          throw new AdapterFailure({
            kind: "parse_failed",
            source: "luogu",
            stage: "parse",
            messageKey: "source.invalidResponse",
            retryable: false,
            requestId: input.requestId,
          });
        }
        const pageKey = parsed.records
          .map((record) => String(record.id))
          .join(",");
        if (pageKey && seenPageKeys.has(pageKey)) {
          reasons.push("pagination-repeated");
          break;
        }
        if (pageKey) seenPageKeys.add(pageKey);
        if (
          parsed.user?.uid !== undefined &&
          /^\d+$/.test(identifier) &&
          String(parsed.user.uid) !== identifier
        )
          throw new AdapterFailure({
            kind: "auth_required",
            source: "luogu",
            stage: "identity",
            messageKey: "account.identityMismatch",
            retryable: false,
            requestId: input.requestId,
          });
        providerUser = parsed.user ?? parsed.currentUser ?? providerUser;
        let pageRecords: Submission[];
        try {
          pageRecords = parsed.records.map((record) =>
            normalizeLuoguRecord(
              record,
              input.account.accountId,
              String(providerUser?.uid ?? providerUser?.name ?? identifier),
              input.now,
            ),
          );
        } catch {
          throw new AdapterFailure({
            kind: "parse_failed",
            source: "luogu",
            stage: "normalize",
            messageKey: "source.invalidRecord",
            retryable: false,
            requestId: input.requestId,
          });
        }
        successfulPages += 1;
        if (
          typeof parsed.count === "number" &&
          Number.isSafeInteger(parsed.count) &&
          parsed.count >= 0 &&
          typeof parsed.perPage === "number" &&
          Number.isSafeInteger(parsed.perPage) &&
          parsed.perPage > 0
        )
          pageEstimate = Math.ceil(parsed.count / parsed.perPage);
        for (const raw of parsed.records) rawRecordIds.add(String(raw.id));
        const validTimes = pageRecords.every(
          (record) =>
            Number.isSafeInteger(record.submittedAt) && record.submittedAt >= 0,
        );
        // Luogu record/list returns newest submissions first. Validate both the
        // raw page sequence and cross-page boundary before using that contract.
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
        const candidates = pageRecords.filter(
          (record) =>
            isWithinSyncWindow(record.submittedAt, input) &&
            !seenRecords.has(record.submissionId),
        );
        for (const record of candidates) {
          if (seenRecords.has(record.submissionId)) continue;
          seenRecords.add(record.submissionId);
          if (records.length < maxRecords) records.push(record);
          else reasons.push("record-limit");
        }
        reportProgress(input.onProgress, {
          phase: "list",
          pagesFetched,
          recordsFetched: records.length,
          pageEstimate,
        });
        const reachedSince =
          ordered &&
          pageRecords.some((record) => record.submittedAt < input.since);
        const hasNext =
          typeof parsed.count === "number" &&
          typeof parsed.perPage === "number" &&
          parsed.perPage > 0
            ? page * parsed.perPage < parsed.count
            : typeof parsed.count === "number"
              ? rawRecordIds.size < parsed.count
              : parsed.records.length > 0;
        if (
          typeof parsed.count !== "number" &&
          parsed.records.length > 0 &&
          !reachedSince
        ) {
          reasons.push("unverified-coverage");
          break;
        }
        if (pageRecords.length === 0 && hasNext) {
          reasons.push("unverified-coverage");
          break;
        }
        if (!hasNext || pageRecords.length === 0) break;
        if (reachedSince) {
          evidence = "window-boundary";
          break;
        }
        if (records.length >= maxRecords) {
          reasons.push("record-limit");
          break;
        }
        if (page >= maxPages) {
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
            source: "luogu",
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
          source: "luogu",
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
        source: "luogu",
        providerAccountKey: String(
          providerUser?.uid ?? providerUser?.name ?? identifier,
        ),
        displayName: providerUser?.name ?? identifier,
      },
      records,
      diagnostics,
      coverage,
    };
  },
};
