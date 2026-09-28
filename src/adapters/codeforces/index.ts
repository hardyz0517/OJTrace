import type { OJAdapter } from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { normalizeCodeforcesSubmission } from "./normalizer";
import { parseCodeforcesResponse } from "./parser";
import { codeforcesListUrl } from "./urls";

export const codeforcesAdapter: OJAdapter = {
  metadata: {
    id: "codeforces",
    displayName: "Codeforces",
    availability: "stable",
    authModes: ["public"],
    capabilities: {
      accountLookup: false,
      stableSubmissionId: true,
      directSubmissionUrl: true,
      requiresBrowserSession: false,
      supportsAnonymous: true,
      supportsContentScriptFallback: false,
    },
  },

  async fetchRecent(input) {
    const handle = input.account.identifier.trim();
    if (!handle) {
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
      response = await input.http.request(
        "codeforces",
        `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=${Math.min(input.limit, 1000)}`,
        { headers: { Accept: "application/json" } },
      );
    } catch (error) {
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
    let records;
    try {
      records = (parsed.result ?? []).map((item) =>
        normalizeCodeforcesSubmission(
          item,
          input.account.accountId,
          handle,
          input.now,
        ),
      );
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
    return {
      account: {
        accountId: input.account.accountId,
        source: "codeforces",
        providerAccountKey: handle,
        displayName: handle,
      },
      records,
      diagnostics: [],
      hasMore: records.length >= Math.min(input.limit, 1000),
    };
  },
};

export { codeforcesListUrl } from "./urls";
