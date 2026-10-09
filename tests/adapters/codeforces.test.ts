import { immediatePagination } from "../helpers/fetch-input";
import { describe, expect, it } from "vitest";
import { normalizeCodeforcesSubmission } from "../../src/adapters/codeforces/normalizer";
import { parseCodeforcesResponse } from "../../src/adapters/codeforces/parser";
import { codeforcesAdapter } from "../../src/adapters/codeforces";
import { HttpClientError } from "../../src/platform/network/http-client";
import type { HttpClient } from "../../src/domain";

function detectSession(http: HttpClient) {
  return codeforcesAdapter.detectBrowserSession!({
    signal: new AbortController().signal,
    requestId: "request",
    http,
  });
}

function homeResponse(status: number, text: string, headers = new Headers()) {
  return {
    status,
    url: "https://codeforces.com/",
    contentType: "text/html",
    text,
    headers,
  };
}

describe("Codeforces browser session diagnostics", () => {
  it.each([
    [403, "<title>Just a moment...</title>", new Headers()],
    [200, "<title>Just a moment...</title>", new Headers()],
    [403, "challenge", new Headers({ "cf-mitigated": "challenge" })],
    [200, "<script>window._cf_chl_opt = {};</script>", new Headers()],
  ])(
    "reports a Cloudflare challenge with HTTP %i",
    async (status, text, headers) => {
      const result = await detectSession({
        async request() {
          return homeResponse(status, text, headers);
        },
      });
      expect(result).toMatchObject({
        authenticated: false,
        status: "site-error",
      });
      expect(result.diagnostic).toContain("codeforces-cloudflare-challenge");
      expect(result.diagnostic).toContain(`http=${status}`);
      expect(result.diagnostic).toContain("requestId=request");
    },
  );

  it.each([
    [401, "", "unauthenticated", "codeforces-login-required"],
    [
      200,
      '<a href="/enter">Enter</a>',
      "unauthenticated",
      "codeforces-login-required",
    ],
    [
      200,
      "<html>unrecognized page</html>",
      "unauthenticated",
      "codeforces-identity-missing",
    ],
    [403, '<a href="/enter">Enter</a>', "site-error", "codeforces-forbidden"],
    [
      429,
      '<a href="/enter">Enter</a>',
      "site-error",
      "codeforces-rate-limited",
    ],
    [503, "unavailable", "network-error", "codeforces-http-error"],
  ])(
    "preserves the failure reason for HTTP %i",
    async (status, text, expectedStatus, diagnostic) => {
      const result = await detectSession({
        async request() {
          return homeResponse(status, text);
        },
      });
      expect(result.status).toBe(expectedStatus);
      expect(result.diagnostic).toContain(diagnostic);
    },
  );

  it.each([
    [
      new HttpClientError("network", "secret must not be logged"),
      "network-error",
      "kind=network",
    ],
    [
      new HttpClientError("timeout", "secret must not be logged"),
      "network-error",
      "kind=timeout",
    ],
    [
      new HttpClientError("rate_limited", "cooldown", 1000, 429),
      "site-error",
      "codeforces-rate-limited",
    ],
  ])(
    "diagnoses transport errors without exposing error messages",
    async (error, expectedStatus, diagnostic) => {
      const result = await detectSession({
        async request() {
          throw error;
        },
      });
      expect(result.status).toBe(expectedStatus);
      expect(result.diagnostic).toContain(diagnostic);
      expect(result.diagnostic).not.toContain("secret");
    },
  );

  it("keeps duplicate session scopes and first-party clearance metadata in a failure", async () => {
    const result = await detectSession({
      async request() {
        return homeResponse(403, "<title>Just a moment...</title>");
      },
      async getCookieMetadata() {
        return [
          {
            name: "JSESSIONID",
            domain: "codeforces.com",
            path: "/",
            hostOnly: true,
            sameSite: "lax",
          },
          {
            name: "JSESSIONID",
            domain: ".codeforces.com",
            path: "/",
            hostOnly: false,
            sameSite: "lax",
          },
          {
            name: "cf_clearance",
            domain: ".codeforces.com",
            path: "/",
            hostOnly: false,
            sameSite: "no_restriction",
            partitionTopLevelSite: "https://codeforces.com",
          },
        ];
      },
    });
    expect(result.diagnostic).toContain("jsessionid-visible-count=2");
    expect(result.diagnostic).toContain(
      "session-scope=codeforces.com/,hostOnly=true",
    );
    expect(result.diagnostic).toContain(
      "session-scope=.codeforces.com/,hostOnly=false",
    );
    expect(result.diagnostic).toContain("clearance-unpartitioned=false");
    expect(result.diagnostic).toContain(
      "clearance-first-party-partitioned=true",
    );
  });

  it("still detects the account if optional cookie inspection fails", async () => {
    const result = await detectSession({
      async getCookieMetadata() {
        throw new Error("cookie read failure");
      },
      async request() {
        return homeResponse(
          200,
          '<a class="user-link" href="/profile/tester">tester</a><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
        );
      },
    });
    expect(result).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "tester",
    });
  });

  it("does not mistake passive Cloudflare scripts for a challenge", async () => {
    const result = await detectSession({
      async request() {
        return homeResponse(
          200,
          '<a class="user-link" href="/profile/tester">tester</a><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
        );
      },
    });
    expect(result.authenticated).toBe(true);
  });
});

describe("Codeforces parser and normalizer", () => {
  it("advertises browser, cookie, and direct username modes", () => {
    expect(codeforcesAdapter.metadata.authModes).toEqual([
      expect.objectContaining({
        type: "browser-session",
        recommended: true,
      }),
      expect.objectContaining({
        type: "manual-cookie",
        identifierRequired: false,
        credentialFields: [
          expect.objectContaining({
            key: "cookie",
            label: "JSESSIONID",
            placeholder: "粘贴 JSESSIONID 的值",
          }),
        ],
      }),
      expect.objectContaining({
        type: "public-handle",
        label: "直接输入用户名",
      }),
    ]);
  });

  it("detects a logged-in browser session from the Codeforces home page", async () => {
    let credentials: RequestCredentials | undefined;
    const result = await codeforcesAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http: {
        async request(_source, _url, options) {
          credentials = options?.credentials;
          return {
            status: 200,
            url: "https://codeforces.com/",
            contentType: "text/html",
            text: '<a class="user-link" href="/profile/tester">tester</a>',
            headers: new Headers(),
          };
        },
      },
    });
    expect(credentials).toBe("include");
    expect(result).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "tester",
    });
  });

  it("uses a manual cookie to discover and fetch the current account", async () => {
    const requests: Array<{
      url: string;
      headers?: Record<string, string>;
      codeforcesCookie?: string;
    }> = [];
    const result = await codeforcesAdapter.fetchRecent({
      since: 0,
      until: Number.MAX_SAFE_INTEGER,
      pagination: immediatePagination(),
      account: {
        accountId: "account",
        source: "codeforces",
        identifier: "",
        enabled: true,
        authMode: "manual-cookie",
      },
      credentials: { cookie: "session" },
      limit: 10,
      signal: new AbortController().signal,
      now: 100,
      requestId: "request",
      http: {
        async request(_source, url, options) {
          requests.push({
            url,
            headers: options?.headers,
            codeforcesCookie: options?.codeforcesCookie,
          });
          return {
            status: 200,
            url,
            contentType: url.endsWith("/") ? "text/html" : "application/json",
            text: url.endsWith("/")
              ? '<a href="/profile/tester">tester</a>'
              : JSON.stringify({ status: "OK", result: [] }),
            headers: new Headers(),
          };
        },
      },
    });
    expect(result.account.providerAccountKey).toBe("tester");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.codeforcesCookie).toBe("JSESSIONID=session");
    expect(requests[1]?.codeforcesCookie).toBeUndefined();
  });

  it("parses a successful response and normalizes epoch seconds", () => {
    const parsed = parseCodeforcesResponse(
      JSON.stringify({
        status: "OK",
        result: [
          {
            id: 42,
            contestId: 10,
            creationTimeSeconds: 1_700_000_000,
            problem: { contestId: 10, index: "A", name: "A + B" },
            programmingLanguage: "GNU C++17",
            verdict: "OK",
            timeConsumedMillis: 80,
            memoryConsumedBytes: 835_584,
          },
        ],
      }),
    );
    const result = normalizeCodeforcesSubmission(
      parsed.result![0]!,
      "local",
      "tourist",
      1_700_000_100_000,
    );
    expect(result.submissionId).toBe("42");
    expect(result.submittedAt).toBe(1_700_000_000_000);
    expect(result.verdict.code).toBe("accepted");
    expect(result.timeMs).toBe(80);
    expect(result.memoryKb).toBe(816);
    expect(result.language).toBe("GNU C++17");
    expect(result.submissionUrl).toBe(
      "https://codeforces.com/contest/10/submission/42",
    );
  });

  it("keeps unknown verdicts instead of throwing", () => {
    const result = normalizeCodeforcesSubmission(
      { id: 1, creationTimeSeconds: 1, verdict: "NEW_STATUS" },
      "local",
      "tourist",
      2,
    );
    expect(result.verdict.code).toBe("other");
    expect(result.verdict.raw).toBe("NEW_STATUS");
  });

  it("uses the gym URL shape for current gym contest ids", () => {
    const result = normalizeCodeforcesSubmission(
      {
        id: 9,
        contestId: 104976,
        creationTimeSeconds: 1_700_000_000,
        problem: { index: "D", name: "Gym problem" },
        verdict: "OK",
      },
      "local",
      "tourist",
      1_700_000_001_000,
    );
    expect(result.submissionUrl).toContain("/gym/104976/submission/9");
    expect(result.problemUrl).toContain("/gym/104976/problem/D");
  });

  it("rejects malformed response status", () => {
    expect(() => parseCodeforcesResponse("{}")).toThrow(
      "Codeforces response has invalid status",
    );
  });

  it("fetches through the constrained HttpClient contract", async () => {
    const response = JSON.stringify({
      status: "OK",
      result: [{ id: 9, creationTimeSeconds: 10, verdict: "WRONG_ANSWER" }],
    });
    const result = await codeforcesAdapter.fetchRecent({
      since: 0,
      until: Number.MAX_SAFE_INTEGER,
      pagination: immediatePagination(),
      account: {
        accountId: "account",
        source: "codeforces",
        identifier: "tourist",
        enabled: true,
        authMode: "public-handle",
      },
      limit: 10,
      signal: new AbortController().signal,
      now: 100,
      requestId: "request",
      http: {
        request: async () => ({
          status: 200,
          url: "https://codeforces.com/api/user.status",
          contentType: "application/json",
          text: response,
          headers: new Headers(),
        }),
      },
    });
    expect(result.records[0]!.verdict.code).toBe("wrong_answer");
  });
});
