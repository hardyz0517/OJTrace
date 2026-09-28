import type { OJAdapter } from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { normalizeLuoguRecord } from "./normalizer";
import { parseLuoguResponse } from "./parser";

export const luoguAdapter: OJAdapter = {
  metadata: {
    id: "luogu",
    displayName: "Luogu",
    availability: "experimental",
    authModes: ["browser_session"],
    capabilities: {
      accountLookup: false,
      stableSubmissionId: true,
      directSubmissionUrl: true,
      requiresBrowserSession: true,
      supportsAnonymous: false,
      supportsContentScriptFallback: false,
    },
  },

  async fetchRecent(input) {
    const identifier = input.account.identifier.trim();
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
    let response;
    try {
      response = await input.http.request(
        "luogu",
        `https://www.luogu.com.cn/record/list?user=${encodeURIComponent(identifier)}&page=1&_contentOnly=1`,
        { headers: { Accept: "application/json" }, credentials: "include" },
      );
    } catch (error) {
      throw AdapterFailure.fromTransport(error, "luogu", input.requestId);
    }
    if (response.status === 401 || response.status === 403) {
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
    let rawRecords;
    try {
      rawRecords = parseLuoguResponse(response.text, response.contentType);
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
    let records;
    try {
      records = rawRecords
        .slice(0, input.limit)
        .map((record) =>
          normalizeLuoguRecord(
            record,
            input.account.accountId,
            identifier,
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
    return {
      account: {
        accountId: input.account.accountId,
        source: "luogu",
        providerAccountKey: identifier,
        displayName: identifier,
      },
      records,
      diagnostics: [],
      hasMore: rawRecords.length > records.length,
    };
  },
};
