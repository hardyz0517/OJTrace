import { sourceDefinitions } from "../../sources/definitions";
import { cookieHeaderFromCredentials, type OJAdapter } from "../../domain";
import { finalizeCoverage } from "../../domain/sync-coverage";
import { reportProgress } from "../../domain/sync-progress";
import { hydroScopedUrl } from "../../domain/hydro-scope";
import { fetchHydroBranding } from "./branding";
import { isHydroOJLoginPage } from "./parser";
import { collectActivityRecords } from "./activities";
import {
  createHydroCollectionBudget,
  fetchRecordPages,
  partialOutcome,
} from "./records";
import {
  originFor,
  scopeFor,
  assertHydroScopeResponse,
  HydroScopeMismatchError,
  parseHydroUser,
  failure,
  assertRecordResponse,
  loginHydroOJ,
  requestPage,
  withInstanceSession,
} from "./session";

const implementation: OJAdapter = {
  metadata: sourceDefinitions.hydroj.metadata,

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
    let identity: ReturnType<typeof parseHydroUser>;
    if (input.account.authMode === "password") {
      identity = await loginHydroOJ(input, origin);
      // Verify access in the selected domain independently of a successful login.
      if (input.account.domainId) {
        const home = await requestPage(
          input,
          hydroScopedUrl(scopeFor(input.account)),
          origin,
          cookie,
        );
        assertRecordResponse(input, home);
        const verified = parseHydroUser(home.text);
        if (verified.uid !== identity.uid)
          throw failure(
            input,
            "auth_required",
            "identity",
            "account.identityChanged",
          );
      }
    } else {
      const home = await requestPage(
        input,
        hydroScopedUrl(scopeFor(input.account)),
        origin,
        cookie,
      );
      assertRecordResponse(input, home);
      identity = parseHydroUser(home.text);
    }
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
    if (!input.origin) return { authenticated: false, status: "site-error" };
    const scope = scopeFor(input);
    const { origin } = scope;
    try {
      const response = await input.http.request(
        "hydroj",
        hydroScopedUrl(scope),
        {
          credentials: "include",
          signal: input.signal,
          headers: { Accept: "text/html" },
          hydroOrigin: origin,
        },
      );
      if (isHydroOJLoginPage(response.text))
        return { authenticated: false, status: "unauthenticated" };
      if (response.status < 200 || response.status >= 300)
        return { authenticated: false, status: "site-error" };
      assertHydroScopeResponse(scope, response);
      const parsed = parseHydroUser(response.text);
      if (parsed.username)
        return {
          authenticated: true,
          status: "authenticated",
          username: parsed.username,
          uid: parsed.uid,
        };
      return { authenticated: false, status: "unauthenticated" };
    } catch (error) {
      if (input.signal.aborted) input.signal.throwIfAborted();
      if (error instanceof HydroScopeMismatchError)
        return {
          authenticated: false,
          status: "site-error",
          diagnostic: "hydro-domain-mismatch",
        };
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
        domainId: input.account.domainId,
        source: "hydroj",
        credentials:
          input.account.authMode === "manual-cookie" ? "omit" : "include",
        cookie,
        signal: input.signal,
        now: input.now,
      });
      return { branding, diagnostics: [] };
    } catch {
      if (input.signal.aborted) input.signal.throwIfAborted();
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
    reportProgress(input.onProgress, { phase: "identity" });
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
      hydroScopedUrl(scopeFor(input.account)),
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
    const budget = createHydroCollectionBudget(input.limit);
    reportProgress(input.onProgress, {
      phase: "list",
      pagesFetched: 0,
      recordsFetched: 0,
    });
    const ordinary = await fetchRecordPages(
      input,
      origin,
      uid,
      cookie,
      undefined,
      100,
      budget,
      refreshSession,
    );
    const activities = await collectActivityRecords(
      input,
      origin,
      uid,
      cookie,
      budget,
      refreshSession,
    );
    const diagnostics = ordinary.diagnostics.concat(activities.diagnostics);
    if (
      ordinary.outcome.status === "partial" &&
      ordinary.outcome.reasons.includes("record-limit")
    )
      diagnostics.push({
        source: "hydroj",
        code: "record-limit",
        severity: "warning",
        messageKey: "source.recordLimit",
        retryable: false,
      });
    const reasons = [ordinary.outcome, activities.outcome].flatMap((outcome) =>
      outcome.status === "partial" ? outcome.reasons : [],
    );
    const records = [...budget.records.values()].sort(
      (a, b) => b.submittedAt - a.submittedAt,
    );
    const coverage = finalizeCoverage(
      input,
      budget.pagesFetched,
      records.length,
      reasons.length
        ? partialOutcome(reasons)
        : { status: "complete", evidence: "all-streams" },
    );
    return {
      account: {
        accountId: input.account.accountId,
        source: "hydroj",
        providerAccountKey: uid,
        displayName:
          identity.username ?? input.account.providerDisplayName ?? uid,
      },
      records,
      diagnostics,
      coverage,
      activitySchedules: [...budget.activitySchedules.values()],
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
    withInstanceSession(originFor(input), () =>
      implementation.detectBrowserSession!(input),
    ),
};
