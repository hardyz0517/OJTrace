import { authorizeFromRecent } from "../authorization";
import {
  cookieHeaderFromCredentials,
  type BrowserSessionInput,
  type FetchInput,
  type OJAdapter,
  type Submission,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { normalizeLuoguRecord } from "./normalizer";
import { parseLuoguDocument, parseLuoguIdentityDocument } from "./parser";
import { luoguRecordListUrl, luoguUserSettingUrl } from "./urls";

function isAuthResponse(response: { status: number; text: string }): boolean {
  return (
    response.status === 401 ||
    /UserUnloginException|"errorCode"\s*:\s*401|请先登录|login required/i.test(
      response.text.slice(0, 20_000),
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
    throw AdapterFailure.fromTransport(error, "luogu", input.requestId);
  }
}

async function currentLuoguUser(input: BrowserSessionInput) {
  const response = await requestLuogu(input, luoguUserSettingUrl());
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
  authorize(input) {
    return authorizeFromRecent(this, input);
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
    try {
      const user = await currentLuoguUser(input);
      return {
        authenticated: true,
        status: "authenticated",
        ...(user.name ? { username: user.name } : {}),
        ...(user.uid !== undefined ? { uid: String(user.uid) } : {}),
      };
    } catch (error) {
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
    const shouldPage = input.since !== undefined;
    const maxPages = 100;
    const records: Submission[] = [];
    let providerUser = identity;
    let page = 1;
    let hasMore = false;
    let reachedSince = false;
    const seenPageKeys = new Set<string>();

    while (true) {
      const response = await requestLuogu(
        input,
        luoguRecordListUrl(identifier, page),
        authMode,
        manualCookie,
      );
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
      if (pageKey && seenPageKeys.has(pageKey)) break;
      if (pageKey) seenPageKeys.add(pageKey);
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
      reachedSince =
        input.since !== undefined &&
        pageRecords.some((record) => record.submittedAt < input.since!);
      records.push(
        ...pageRecords
          .filter(
            (record) =>
              input.since === undefined || record.submittedAt >= input.since,
          )
          .slice(0, maxRecords - records.length),
      );
      hasMore =
        (typeof parsed.count === "number" &&
          parsed.count > pageRecords.length) ||
        parsed.records.length > 0;
      if (
        !shouldPage ||
        !hasMore ||
        pageRecords.length === 0 ||
        reachedSince ||
        records.length >= maxRecords ||
        page >= maxPages
      ) {
        break;
      }
      page += 1;
    }
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
      diagnostics: [],
      hasMore: hasMore && !reachedSince,
    };
  },
};
