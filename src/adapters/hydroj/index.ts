import type { OJAdapter } from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { createHydroOJInstance, hydroOJRecordsUrl } from "./instance";
import { isHydroOJLoginPage, parseHydroOJRecordPage } from "./parser";
import { normalizeHydroOJSubmission } from "./normalizer";

function originFor(account: { origin?: string }): string {
  return createHydroOJInstance(account.origin).origin;
}

function hydroCookie(account: {
  credentials?: Record<string, string>;
  cookie?: string;
}): string | undefined {
  return (
    account.credentials?.cookie?.trim() || account.cookie?.trim() || undefined
  );
}

function parseHydroUser(text: string): { uid?: string; username?: string } {
  const raw = text.match(/window\.UserContext\s*=\s*'([\s\S]*?)';/i)?.[1];
  if (!raw) return {};
  try {
    const user = JSON.parse(raw) as { _id?: number; uname?: string };
    return {
      uid: Number.isFinite(user._id) ? String(user._id) : undefined,
      username: user.uname && user.uname !== "Guest" ? user.uname : undefined,
    };
  } catch {
    return {};
  }
}

async function loginHydroOJ(
  input: Parameters<NonNullable<OJAdapter["fetchRecent"]>>[0],
  origin: string,
): Promise<{ uid?: string; username?: string }> {
  const username = input.account.credentials?.username?.trim();
  const password = input.account.credentials?.password ?? "";
  if (!username || !password) {
    throw new AdapterFailure({
      kind: "invalid_response",
      source: "hydroj",
      stage: "identity",
      messageKey: "account.loginCredentialsRequired",
      retryable: false,
      userAction: "edit_account",
      requestId: input.requestId,
    });
  }
  let response;
  try {
    response = await input.http.request(
      "hydroj",
      new URL("/login", origin).href,
      {
        method: "POST",
        body: new URLSearchParams({
          uname: username,
          password,
          rememberme: "on",
          tfa: "",
          authnChallenge: "",
          login_submit: "登录",
        }).toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/html",
        },
        credentials: "include",
        followRedirects: true,
        signal: input.signal,
        hydroOrigin: origin,
      },
    );
  } catch (error) {
    throw AdapterFailure.fromTransport(error, "hydroj", input.requestId);
  }
  const identity = parseHydroUser(response.text);
  if (
    response.status < 200 ||
    response.status >= 300 ||
    isHydroOJLoginPage(response.text) ||
    !identity.username
  ) {
    throw new AdapterFailure({
      kind: "auth_required",
      source: "hydroj",
      stage: "identity",
      messageKey: "source.loginFailed",
      retryable: false,
      userAction: "edit_account",
      httpStatus: response.status,
      requestId: input.requestId,
    });
  }
  return identity;
}

function resolvePath(
  origin: string,
  path: string | undefined,
): string | undefined {
  return path ? new URL(path, origin).href : undefined;
}

export const hydroOJAdapter: OJAdapter = {
  metadata: {
    id: "hydroj",
    displayName: "HydroOJ",
    availability: "stable",
    authModes: [
      {
        type: "browser-session",
        recommended: true,
        label: "使用当前浏览器登录状态",
        description: "使用当前 HydroOJ 实例的浏览器登录状态。",
      },
      {
        type: "manual-cookie",
        label: "手动配置",
        description: "只需粘贴当前实例的 sid 和 sid.sig Cookie，无需填写 UID。",
        identifierRequired: false,
        credentialFields: [
          {
            key: "sid",
            label: "sid",
            type: "password",
            placeholder: "粘贴 sid 值",
          },
          {
            key: "sid.sig",
            label: "sid.sig",
            type: "password",
            placeholder: "粘贴 sid.sig 值",
          },
        ],
      },
      {
        type: "password",
        label: "账号密码登录",
        description: "使用 HydroOJ 用户名和密码登录；会话过期后自动重新登录。",
        identifierRequired: false,
        credentialFields: [
          {
            key: "username",
            label: "用户名",
            type: "text",
            placeholder: "例如 username",
          },
          {
            key: "password",
            label: "密码",
            type: "password",
            placeholder: "输入 HydroOJ 密码",
          },
        ],
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
    dataOrigins: [],
  },

  async detectBrowserSession(input) {
    const origin =
      input.origin ??
      (input.pageIdentity?.includes("://") ? input.pageIdentity : undefined);
    if (!origin) return { authenticated: false, status: "site-error" };
    try {
      const response = await input.http.request(
        "hydroj",
        new URL("/", origin).href,
        {
          credentials: "include",
          signal: input.signal,
          headers: { Accept: "text/html" },
          hydroOrigin: origin,
        },
      );
      if (isHydroOJLoginPage(response.text))
        return { authenticated: false, status: "unauthenticated" };
      const user = response.text.match(
        /window\.UserContext\s*=\s*'([\s\S]*?)';/i,
      )?.[1];
      const parsed = user
        ? (JSON.parse(user) as { _id?: number; uname?: string })
        : undefined;
      if (parsed?.uname && parsed.uname !== "Guest")
        return {
          authenticated: true,
          status: "authenticated",
          username: parsed.uname,
          uid: parsed._id ? String(parsed._id) : undefined,
        };
      return { authenticated: false, status: "unauthenticated" };
    } catch {
      return { authenticated: false, status: "network-error" };
    }
  },

  async fetchRecent(input) {
    const origin = originFor(input.account);
    let identifier = input.account.identifier.trim();
    if (
      !["browser-session", "manual-cookie", "password"].includes(
        input.account.authMode,
      )
    )
      throw new AdapterFailure({
        kind: "unsupported",
        source: "hydroj",
        stage: "identity",
        messageKey: "account.authModeUnsupported",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    const manualCookie =
      input.account.credentials?.sid && input.account.credentials?.["sid.sig"]
        ? `sid=${input.account.credentials.sid}; sid.sig=${input.account.credentials["sid.sig"]}`
        : hydroCookie(input.account);
    if (input.account.authMode === "manual-cookie" && !manualCookie)
      throw new AdapterFailure({
        kind: "invalid_response",
        source: "hydroj",
        stage: "identity",
        messageKey: "account.cookieRequired",
        retryable: false,
        userAction: "edit_account",
        requestId: input.requestId,
      });
    let loginIdentity: { uid?: string; username?: string } = {};
    let response;
    try {
      response = await input.http.request(
        "hydroj",
        hydroOJRecordsUrl(origin, identifier || "0"),
        {
          credentials:
            input.account.authMode === "manual-cookie" ? "omit" : "include",
          ...(manualCookie ? { headers: { Cookie: manualCookie } } : {}),
          signal: input.signal,
          hydroOrigin: origin,
        },
      );
    } catch (error) {
      throw AdapterFailure.fromTransport(error, "hydroj", input.requestId);
    }
    if (
      input.account.authMode === "password" &&
      (response.status === 401 || isHydroOJLoginPage(response.text))
    ) {
      loginIdentity = await loginHydroOJ(input, origin);
      try {
        response = await input.http.request(
          "hydroj",
          hydroOJRecordsUrl(origin, loginIdentity.username ?? "0"),
          {
            credentials: "include",
            signal: input.signal,
            hydroOrigin: origin,
          },
        );
      } catch (error) {
        throw AdapterFailure.fromTransport(error, "hydroj", input.requestId);
      }
    }
    if (response.status === 401 || isHydroOJLoginPage(response.text))
      throw new AdapterFailure({
        kind: "auth_required",
        source: "hydroj",
        stage: "request",
        messageKey: "source.authRequired",
        retryable: false,
        userAction: "open_site_login",
        httpStatus: response.status,
        requestId: input.requestId,
      });
    if (response.status === 429)
      throw new AdapterFailure({
        kind: "rate_limited",
        source: "hydroj",
        stage: "request",
        messageKey: "source.rateLimited",
        retryable: false,
        userAction: "retry_later",
        httpStatus: response.status,
        requestId: input.requestId,
      });
    if (response.status < 200 || response.status >= 300)
      throw new AdapterFailure({
        kind: response.status === 403 ? "blocked" : "network",
        source: "hydroj",
        stage: "request",
        messageKey: "source.httpError",
        retryable: response.status >= 500,
        httpStatus: response.status,
        requestId: input.requestId,
      });
    let page;
    try {
      page = parseHydroOJRecordPage(response.text);
    } catch {
      throw new AdapterFailure({
        kind: "parse_failed",
        source: "hydroj",
        stage: "parse",
        messageKey: "source.invalidResponse",
        retryable: false,
        requestId: input.requestId,
      });
    }
    const responseIdentity = parseHydroUser(response.text);
    if (!identifier)
      identifier =
        loginIdentity.username ?? responseIdentity.username ?? "hydroj-user";
    const listIdentifier = identifier || "0";
    const records = page.rdocs
      .slice(0, Math.min(input.limit, 100))
      .map((raw) => {
        const item = normalizeHydroOJSubmission(raw);
        return {
          source: "hydroj" as const,
          accountId: input.account.accountId,
          providerAccountKey: listIdentifier,
          origin,
          submissionId: item.submissionId,
          identityQuality: "stable" as const,
          problemId: item.problemId,
          problemName: item.problemName,
          submittedAt: item.submittedAt,
          verdict: item.verdict,
          score: item.score,
          timeMs: item.timeMs,
          memoryKb: item.memoryKb,
          language: item.language,
          submissionUrl: resolvePath(origin, item.submissionPath),
          problemUrl: resolvePath(origin, item.problemPath),
          fallbackListUrl: hydroOJRecordsUrl(origin, listIdentifier),
          fetchedAt: input.now,
        };
      });
    return {
      account: {
        accountId: input.account.accountId,
        source: "hydroj",
        providerAccountKey: listIdentifier,
        displayName: listIdentifier,
      },
      records,
      diagnostics: [],
      hasMore: page.hasMore,
    };
  },
};
