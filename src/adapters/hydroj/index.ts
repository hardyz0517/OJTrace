import { cookieHeaderFromCredentials, type OJAdapter } from "../../domain";
import { mergeSubmissions, submissionKey } from "../../domain/merge";
import { fetchHydroBranding } from "./branding";
import { isHydroOJLoginPage } from "./parser";
import { collectActivityRecords } from "./activities";
import { fetchRecordPages } from "./records";
import {
  originFor,
  parseHydroUser,
  failure,
  assertRecordResponse,
  loginHydroOJ,
  requestPage,
  withInstanceSession,
} from "./session";

const implementation: OJAdapter = {
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
        identifierRequired: false,
        credentialFields: [
          {
            key: "sid",
            label: "sid",
            type: "password",
            credentialType: "cookie",
            placeholder: "粘贴 sid 值",
          },
          {
            key: "sid.sig",
            label: "sid.sig",
            type: "password",
            credentialType: "cookie",
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

  async authorize(input) {
    const origin = originFor(input.account);
    const cookie =
      input.account.authMode === "manual-cookie"
        ? cookieHeaderFromCredentials(input.credentials, ["sid", "sid.sig"])
        : undefined;
    if (input.account.authMode === "manual-cookie" && !cookie)
      throw failure(
        input,
        "invalid_response",
        "identity",
        "account.cookieRequired",
      );
    const identity =
      input.account.authMode === "password"
        ? await loginHydroOJ(input, origin)
        : parseHydroUser(
            (
              await requestPage(
                input,
                new URL("/", origin).href,
                origin,
                cookie,
              )
            ).text,
          );
    if (!identity.uid || !identity.username)
      throw failure(input, "auth_required", "identity", "source.authRequired");
    return {
      accountId: input.account.accountId,
      source: "hydroj",
      providerAccountKey: identity.uid,
      displayName: identity.username,
    };
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
      const parsed = parseHydroUser(response.text);
      if (parsed.username)
        return {
          authenticated: true,
          status: "authenticated",
          username: parsed.username,
          uid: parsed.uid,
        };
      return { authenticated: false, status: "unauthenticated" };
    } catch {
      return { authenticated: false, status: "network-error" };
    }
  },

  async fetchInstanceBranding(input) {
    const origin = originFor(input.account);
    const cookie = cookieHeaderFromCredentials(input.credentials, [
      "sid",
      "sid.sig",
    ]);
    try {
      const branding = await fetchHydroBranding(input.http, {
        origin,
        source: "hydroj",
        credentials:
          input.account.authMode === "manual-cookie" ? "omit" : "include",
        cookie,
        signal: input.signal,
        now: input.now,
      });
      return { branding, diagnostics: [] };
    } catch {
      return {
        diagnostics: [
          {
            source: "hydroj",
            code: "branding-unavailable",
            severity: "warning",
            messageKey: "source.brandingUnavailable",
            retryable: true,
          },
        ],
      };
    }
  },

  async fetchRecent(input) {
    const origin = originFor(input.account);
    const cookie =
      input.account.authMode === "manual-cookie"
        ? cookieHeaderFromCredentials(input.credentials, ["sid", "sid.sig"])
        : undefined;
    if (input.account.authMode === "manual-cookie" && !cookie)
      throw failure(
        input,
        "invalid_response",
        "identity",
        "account.cookieRequired",
      );
    if (
      !["browser-session", "manual-cookie", "password"].includes(
        input.account.authMode,
      )
    )
      throw failure(
        input,
        "unsupported",
        "identity",
        "account.authModeUnsupported",
      );

    // Always verify the active session, including when records are requested as JSON.
    const home = await requestPage(
      input,
      new URL("/", origin).href,
      origin,
      cookie,
    );
    let identity = parseHydroUser(home.text);
    if (
      input.account.authMode === "password" &&
      (!identity.uid ||
        (input.account.providerAccountKey &&
          identity.uid !== input.account.providerAccountKey))
    )
      identity = await loginHydroOJ(input, origin);
    else assertRecordResponse(input, home);
    if (!identity.uid)
      throw failure(input, "auth_required", "identity", "source.authRequired");
    if (
      input.account.providerAccountKey &&
      identity.uid !== input.account.providerAccountKey
    )
      throw failure(
        input,
        "auth_required",
        "identity",
        "account.identityChanged",
      );
    const uid = identity.uid;
    const refreshSession =
      input.account.authMode === "password"
        ? async () => {
            const refreshed = await loginHydroOJ(input, origin);
            if (refreshed.uid !== uid)
              throw failure(
                input,
                "auth_required",
                "identity",
                "account.identityChanged",
              );
          }
        : undefined;
    const ordinary = await fetchRecordPages(
      input,
      origin,
      uid,
      cookie,
      undefined,
      undefined,
      100,
      input.limit,
      refreshSession,
    );
    const activities = await collectActivityRecords(
      input,
      origin,
      uid,
      cookie,
      refreshSession,
    );
    const allRecords = ordinary.records.concat(activities.records);
    const diagnostics = ordinary.diagnostics.concat(activities.diagnostics);
    if (ordinary.hasMore)
      diagnostics.push({
        source: "hydroj",
        code: "record-limit",
        severity: "warning",
        messageKey: "source.recordLimit",
        retryable: false,
      });
    const activityIds = new Map<string, string>();
    for (const record of allRecords) {
      if (!record.activityId) continue;
      const key = submissionKey(record);
      const previous = activityIds.get(key);
      if (previous && previous !== record.activityId)
        diagnostics.push({
          source: "hydroj",
          code: "activity-conflict",
          severity: "warning",
          messageKey: "source.activityConflict",
          retryable: false,
        });
      else activityIds.set(key, record.activityId);
    }
    const limit = Math.min(input.limit, 1000);
    const merged = mergeSubmissions([], allRecords, Number.MAX_SAFE_INTEGER);
    if (merged.length > limit)
      diagnostics.push({
        source: "hydroj",
        code: "output-limit",
        severity: "warning",
        messageKey: "source.outputLimit",
        retryable: false,
      });
    return {
      account: {
        accountId: input.account.accountId,
        source: "hydroj",
        providerAccountKey: uid,
        displayName:
          identity.username ?? input.account.providerDisplayName ?? uid,
      },
      records: merged.slice(0, limit),
      diagnostics,
      hasMore: ordinary.hasMore || activities.hasMore || merged.length > limit,
    };
  },
};

export const hydroOJAdapter: OJAdapter = {
  ...implementation,
  authorize: (input) =>
    withInstanceSession(originFor(input.account), () =>
      implementation.authorize(input),
    ),
  fetchRecent: (input) =>
    withInstanceSession(originFor(input.account), () =>
      implementation.fetchRecent(input),
    ),
  fetchInstanceBranding: (input) =>
    withInstanceSession(originFor(input.account), () =>
      implementation.fetchInstanceBranding!(input),
    ),
  detectBrowserSession: (input) =>
    withInstanceSession(originFor({ origin: input.origin }), () =>
      implementation.detectBrowserSession!(input),
    ),
};
