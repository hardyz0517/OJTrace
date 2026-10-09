import { LUOGU_ORIGIN } from "./urls";
import {
  DescendingWindowTracker,
  WindowRecordBuffer,
  PageSignatures,
  PageProgress,
  classifiedPageFailure,
} from "../shared/page-state";
import { finalizeCoverage } from "../../domain/sync-coverage";
import { sourceDefinitions } from "../../sources/definitions";
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
import { AdapterFailure, createAdapterFailure } from "../../domain/errors";
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
    throw createAdapterFailure("luogu", input.requestId, {
      kind: "auth_required",
      stage: "identity",
      messageKey: "source.authRequired",
      retryable: false,
      userAction: "open_site_login",
      httpStatus: response.status,
    });
  }
  if (response.status === 403) {
    throw createAdapterFailure("luogu", input.requestId, {
      kind: "blocked",
      stage: "identity",
      messageKey: "source.blocked",
      retryable: false,
      userAction: "retry_later",
      httpStatus: response.status,
    });
  }
  if (response.status === 429) {
    throw createAdapterFailure("luogu", input.requestId, {
      kind: "rate_limited",
      stage: "identity",
      messageKey: "source.rateLimited",
      retryable: false,
      userAction: "retry_later",
      httpStatus: response.status,
    });
  }
  if (response.status < 200 || response.status >= 300) {
    throw createAdapterFailure("luogu", input.requestId, {
      kind: "network",
      stage: "identity",
      messageKey: "source.httpError",
      retryable: response.status >= 500,
      httpStatus: response.status,
    });
  }
  try {
    return parseLuoguIdentityDocument(response.text, response.contentType);
  } catch {
    throw createAdapterFailure("luogu", input.requestId, {
      kind: "parse_failed",
      stage: "identity",
      messageKey: "source.invalidResponse",
      retryable: false,
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
      throw createAdapterFailure("luogu", input.requestId, {
        kind: "invalid_response",
        stage: "identity",
        messageKey: "account.cookieRequired",
        retryable: false,
      });
    if (
      input.account.authMode !== "manual-cookie" &&
      input.account.authMode !== "browser-session"
    )
      throw createAdapterFailure("luogu", input.requestId, {
        kind: "unsupported",
        stage: "identity",
        messageKey: "account.authModeUnsupported",
        retryable: false,
      });
    const user = await currentLuoguUser(input, cookie);
    return {
      accountId: input.account.accountId,
      source: "luogu",
      providerAccountKey: String(user.uid ?? user.name),
      displayName: user.name,
    };
  },
  metadata: sourceDefinitions.luogu.metadata,

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
      throw createAdapterFailure("luogu", input.requestId, {
        kind: "invalid_response",
        stage: "identity",
        messageKey: "account.authModeUnsupported",
        retryable: false,
        userAction: "edit_account",
      });
    }
    const manualCookie = manualLuoguCookie(input.credentials);
    if (authMode === "manual-cookie" && !manualCookie) {
      throw createAdapterFailure("luogu", input.requestId, {
        kind: "invalid_response",
        stage: "identity",
        messageKey: "account.cookieRequired",
        retryable: false,
        userAction: "edit_account",
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
      throw createAdapterFailure("luogu", input.requestId, {
        kind: "invalid_response",
        stage: "identity",
        messageKey: "account.identifierRequired",
        retryable: false,
        userAction: "edit_account",
      });
    }
    const maxRecords = Math.max(1, Math.min(input.limit, 1_000));
    const maxPages = 100;
    const buffer = new WindowRecordBuffer(input, maxRecords);
    const records = buffer.records;
    let providerUser = identity;
    let page = 1;
    const reasons: PartialReason[] = [];
    const diagnostics: Diagnostic[] = [];
    const progress = new PageProgress(input.onProgress, records, true);
    let pageEstimate: number | undefined;
    let successfulPages = 0;
    const rawRecordIds = new Set<string>();
    let evidence: "exhausted" | "window-boundary" = "exhausted";
    const order = new DescendingWindowTracker();
    const signatures = new PageSignatures();

    while (true) {
      try {
        const response = await input.pagination.runPage({
          origin: LUOGU_ORIGIN,
          signal: input.signal,
          request: () => {
            progress.dispatched(pageEstimate);
            return requestLuogu(
              input,
              luoguRecordListUrl(identifier, page),
              authMode,
              manualCookie,
            );
          },
        });
        if (isAuthResponse(response)) {
          throw createAdapterFailure("luogu", input.requestId, {
            kind: "auth_required",
            stage: "request",
            messageKey: "source.authRequired",
            retryable: false,
            userAction: "open_site_login",
            httpStatus: response.status,
          });
        }
        if (response.status === 403) {
          throw createAdapterFailure("luogu", input.requestId, {
            kind: "blocked",
            stage: "request",
            messageKey: "source.blocked",
            retryable: false,
            userAction: "retry_later",
            httpStatus: response.status,
          });
        }
        if (response.status === 429) {
          throw createAdapterFailure("luogu", input.requestId, {
            kind: "rate_limited",
            stage: "request",
            messageKey: "source.rateLimited",
            retryable: false,
            userAction: "retry_later",
            httpStatus: response.status,
          });
        }
        if (response.status < 200 || response.status >= 300) {
          throw createAdapterFailure("luogu", input.requestId, {
            kind: "network",
            stage: "request",
            messageKey: "source.httpError",
            retryable: response.status >= 500,
            httpStatus: response.status,
          });
        }
        let parsed;
        try {
          parsed = parseLuoguDocument(response.text, response.contentType);
        } catch {
          throw createAdapterFailure("luogu", input.requestId, {
            kind: "parse_failed",
            stage: "parse",
            messageKey: "source.invalidResponse",
            retryable: false,
          });
        }
        const pageKey = parsed.records
          .map((record) => String(record.id))
          .join(",");
        if (signatures.repeated(pageKey)) {
          reasons.push("pagination-repeated");
          break;
        }
        if (
          parsed.user?.uid !== undefined &&
          /^\d+$/.test(identifier) &&
          String(parsed.user.uid) !== identifier
        )
          throw createAdapterFailure("luogu", input.requestId, {
            kind: "auth_required",
            stage: "identity",
            messageKey: "account.identityMismatch",
            retryable: false,
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
          throw createAdapterFailure("luogu", input.requestId, {
            kind: "parse_failed",
            stage: "normalize",
            messageKey: "source.invalidRecord",
            retryable: false,
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
        const { validTimes, reachedSince } = order.observe(
          pageRecords,
          input.since,
        );
        if (!validTimes) reasons.push("invalid-record");
        if (buffer.append(pageRecords)) reasons.push("record-limit");
        progress.report(pageEstimate);
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
        const partial = classifiedPageFailure(
          error,
          input.signal,
          successfulPages,
          "luogu",
        );
        reasons.push(partial.reason);
        diagnostics.push(partial.diagnostic);
        break;
      }
    }
    const coverage = finalizeCoverage(
      input,
      progress.pagesFetched,
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
