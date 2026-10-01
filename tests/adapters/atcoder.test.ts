import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  atcoderAdapter,
  normalizeAtCoderSubmission,
  parseAtCoderSubmissionDetails,
  parseAtCoderSubmissions,
} from "../../src/adapters/atcoder";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../docs/fixtures/atcoder/${name}`, import.meta.url),
    "utf8",
  );

describe("AtCoder adapter", () => {
  it("advertises browser session first and manual-cookie as fallback", () => {
    expect(atcoderAdapter.metadata.authModes).toEqual([
      expect.objectContaining({ type: "browser-session", recommended: true }),
      expect.objectContaining({
        type: "manual-cookie",
        identifierRequired: false,
        credentialFields: [expect.objectContaining({ key: "REVEL_SESSION" })],
      }),
    ]);
    const rows = parseAtCoderSubmissions(fixture("submissions-ok.json"));
    const submission = normalizeAtCoderSubmission(
      rows[0]!,
      "local",
      "sample-user",
      2_000,
    );
    expect(submission.submittedAt).toBe(1_700_000_000_000);
    expect(submission.verdict.code).toBe("accepted");
    expect(submission.submissionUrl).toBe(
      "https://atcoder.jp/contests/abc001/submissions/12345678",
    );
    expect(parseAtCoderSubmissions(fixture("submissions-empty.json"))).toEqual(
      [],
    );
    expect(() =>
      parseAtCoderSubmissions(fixture("submissions-invalid.json")),
    ).toThrow();
  });

  it("parses memory from the official submission detail page", () => {
    expect(
      parseAtCoderSubmissionDetails(
        '<tr><th>Memory</th><td class="text-center">13044 KiB</td></tr>',
      ),
    ).toEqual({ memory: 13044 });
  });

  it("uses the browser session and classifies the sign-in page", async () => {
    let requestOptions: { credentials?: RequestCredentials } | undefined;
    const account = await atcoderAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http: {
        request: async (_source, _url, options) => {
          requestOptions = options;
          return {
            status: 200,
            url: "https://atcoder.jp/users/atcoder",
            contentType: "text/html",
            text: "<title>Sign In - AtCoder</title>",
            headers: new Headers(),
          };
        },
      },
    });
    expect(requestOptions?.credentials).toBe("include");
    expect(account).toEqual({
      authenticated: false,
      status: "unauthenticated",
    });
  });

  it("extracts the username from a logged-in home page", async () => {
    const account = await atcoderAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http: {
        request: async () => ({
          status: 200,
          url: "https://atcoder.jp/",
          contentType: "text/html",
          text: '<script>var userScreenName = "Hardy_Zheng";</script>',
          headers: new Headers(),
        }),
      },
    });
    expect(account).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "Hardy_Zheng",
    });
  });

  it("accepts the identity read from the logged-in AtCoder page", async () => {
    const account = await atcoderAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      pageIdentity: "Hardy_Zheng",
      http: {
        request: async () => {
          throw new Error("page identity should avoid service-worker fetch");
        },
      },
    });
    expect(account).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "Hardy_Zheng",
    });
  });

  it("wraps a manual token as the REVEL_SESSION cookie", async () => {
    const requests: Array<{
      url: string;
      headers?: Record<string, string>;
    }> = [];
    await expect(
      atcoderAdapter.fetchRecent({
        account: {
          accountId: "local",
          source: "atcoder",
          identifier: "",
          enabled: true,
          authMode: "manual-cookie",
          credentials: { REVEL_SESSION: "session-token" },
        },
        limit: 10,
        signal: new AbortController().signal,
        now: 2_000,
        requestId: "request",
        http: {
          request: async (_source, url, options) => {
            requests.push({ url, headers: options?.headers });
            return {
              status: 200,
              url,
              contentType: url.endsWith("/submissions")
                ? "application/json"
                : "text/html",
              text: url.includes("kenkoooo.com")
                ? "[]"
                : '<script>var userScreenName = "Hardy_Zheng";</script>',
              headers: new Headers(),
            };
          },
        },
      }),
    ).resolves.toMatchObject({ records: [] });
    expect(requests).toHaveLength(3);
    expect(requests[0]?.headers?.Cookie).toBeUndefined();
    expect(requests[1]?.url).toBe(
      "https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=Hardy_Zheng&from_second=0",
    );
  });
});
