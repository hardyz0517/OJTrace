import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../src/domain";
import { AdapterFailure } from "../../src/domain/errors";
import { qojAdapter, qojCookieFromCredentials } from "../../src/adapters/qoj";
import { normalizeQOJRecord } from "../../src/adapters/qoj/normalizer";
import {
  isQOJLoginPage,
  parseQOJIdentity,
  parseQOJRecordPage,
} from "../../src/adapters/qoj/parser";
import {
  qojSubmissionListUrl,
  qojSubmissionUrl,
} from "../../src/adapters/qoj/urls";

const fixture = readFileSync(
  new URL("../../docs/fixtures/qoj/submissions-page.html", import.meta.url),
  "utf8",
);
const liveFixture = readFileSync(
  new URL(
    "../../docs/fixtures/qoj/live-submissions-page.html",
    import.meta.url,
  ),
  "utf8",
);

describe("QOJ adapter", () => {
  it("builds the UOJ list and detail routes", () => {
    expect(qojSubmissionListUrl("sample_user")).toBe(
      "https://qoj.ac/submissions?submitter=sample_user",
    );
    expect(qojSubmissionListUrl("sample_user", 2)).toContain("page=2");
    expect(qojSubmissionUrl(12345)).toBe("https://qoj.ac/submission/12345");
  });

  it("recognizes login pages and extracts the logged-in UOJ identity", () => {
    expect(
      isQOJLoginPage(
        readFileSync(
          new URL("../../docs/fixtures/qoj/login.html", import.meta.url),
          "utf8",
        ),
        "https://qoj.ac/login",
      ),
    ).toBe(true);
    expect(parseQOJIdentity(fixture)).toBe("sample_user");
    expect(
      parseQOJIdentity(
        '<ul class="nav nav-pills float-right"><li><a class="nav-link dropdown-toggle" href="#" data-toggle="dropdown"><a class="uoj-username" href="//qoj.ac/user/profile/Hardy">Hardy</a></a></li><li><a class="nav-link" href="//qoj.ac/logout?_token=test">Logout</a></li></ul>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<span class="uoj-username" data-rating="1000">top_user</span>',
      ),
    ).toBeUndefined();
    expect(
      parseQOJIdentity(
        '<a class="nav-link dropdown-toggle" data-toggle="dropdown" href="#">Login</a><a class="uoj-username" href="//qoj.ac/user/profile/top_user">top_user</a>',
      ),
    ).toBeUndefined();
    expect(
      parseQOJIdentity(
        '<a class="uoj-username" href="//qoj.ac/user/profile/Hardy">Hardy</a><a href="//qoj.ac/logout?_token=test">Logout</a>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<a class="uoj-username" href="//qoj.ac/user/profile/top_user">top_user</a>',
      ),
    ).toBeUndefined();
  });

  it("parses the plain td table emitted by UOJ and detects pagination", () => {
    const page = parseQOJRecordPage(
      fixture,
      "https://qoj.ac/submissions?submitter=sample_user",
    );
    expect(page).toMatchObject({
      page: 1,
      hasMore: true,
      username: "sample_user",
    });
    expect(page.records).toHaveLength(2);
    expect(page.records[0]).toMatchObject({
      id: "12345",
      problemId: "6665",
      problemName: "Making Teams",
      score: 100,
      timeMs: 42,
      memoryKb: 64,
      codeLength: 1536,
      language: "C++20",
      submittedAt: "2026-09-30 12:34:56",
    });
    expect(page.records[1]).toMatchObject({
      contestId: "2603",
      problemId: "18279",
    });
  });

  it("parses the current QOJ themed table and authenticated nav identity", () => {
    const page = parseQOJRecordPage(
      liveFixture,
      "https://qoj.ac/submissions?page=1",
    );
    expect(page.username).toBe("Hardy");
    expect(page.hasMore).toBe(true);
    expect(page.records).toMatchObject([
      {
        id: "3068669",
        problemId: "15673",
        result: "WA",
        score: 0,
        timeMs: 0,
        memoryKb: 4144,
        language: "C++23",
        codeLength: 7987,
        submittedAt: "2026-10-01 08:27:13",
      },
      {
        id: "3068668",
        problemId: "9869",
        contestId: "1871",
        score: 100,
      },
    ]);
  });

  it("detects the current QOJ browser session from the nav anchor", async () => {
    const result = await qojAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http: {
        async request() {
          return {
            status: 200,
            url: "https://qoj.ac/",
            contentType: "text/html",
            text: liveFixture,
            headers: new Headers(),
          };
        },
      },
    });
    expect(result).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "Hardy",
    });
  });

  it("advertises manual Cookie fallback and reads QOJ cookies", () => {
    expect(qojAdapter.metadata.authModes).toEqual([
      expect.objectContaining({ type: "browser-session", recommended: true }),
      expect.objectContaining({
        type: "manual-cookie",
        identifierRequired: false,
        credentialFields: [expect.objectContaining({ key: "cookie" })],
      }),
    ]);
    expect(
      qojCookieFromCredentials({
        uoj_username: "Hardy",
        uoj_remember_token: "token-value",
      }),
    ).toBe("uoj_username=Hardy; uoj_remember_token=token-value");
    expect(qojCookieFromCredentials({ UOJSESSIONID: "session-value" })).toBe(
      "UOJSESSIONID=session-value",
    );
    expect(qojCookieFromCredentials({ uoj_username: "Hardy" })).toBeUndefined();
  });

  it("fetches QOJ records with a manual Cookie and discovers the account", async () => {
    const requests: Array<{
      url: string;
      options?: Parameters<HttpClient["request"]>[2];
    }> = [];
    const http: HttpClient = {
      request: vi.fn(async (_source, url, options) => {
        requests.push({ url, options });
        return {
          status: 200,
          url,
          contentType: "text/html",
          text: url.endsWith("/") ? liveFixture : liveFixture,
          headers: new Headers(),
        };
      }),
    };
    const result = await qojAdapter.fetchRecent({
      account: {
        accountId: "account-1",
        source: "qoj",
        identifier: "",
        enabled: true,
        authMode: "manual-cookie",
        credentials: { cookie: "uoj_username=Hardy; uoj_remember_token=token" },
      },
      limit: 2,
      signal: new AbortController().signal,
      now: 1,
      requestId: "request-1",
      http,
    });
    expect(result.account.providerAccountKey).toBe("Hardy");
    expect(result.records).toHaveLength(2);
    expect(requests[0]?.options).toMatchObject({
      credentials: "omit",
      headers: {
        Cookie: "uoj_username=Hardy; uoj_remember_token=token",
      },
    });
  });

  it("accepts an authenticated empty table as an empty history", () => {
    const page = parseQOJRecordPage(
      '<html><title>Submissions</title><table><tbody><tr><td colspan="9">None</td></tr></tbody></table></html>',
      "https://qoj.ac/submissions?submitter=sample_user",
    );
    expect(page.records).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("normalizes scores, pending results, and QOJ timestamps", () => {
    const page = parseQOJRecordPage(fixture);
    const accepted = normalizeQOJRecord(
      page.records[0]!,
      "account-1",
      "sample_user",
      1,
    );
    const pending = normalizeQOJRecord(
      page.records[1]!,
      "account-1",
      "sample_user",
      1,
    );
    expect(accepted).toMatchObject({
      submissionId: "12345",
      verdict: { code: "accepted", raw: "100" },
      submittedAt: Date.parse("2026-09-30T12:34:56+08:00"),
      submissionUrl: "https://qoj.ac/submission/12345",
    });
    expect(pending.verdict.code).toBe("pending");
  });

  it("fetches multiple UOJ pages with the browser session", async () => {
    const loginPage = readFileSync(
      new URL("../../docs/fixtures/qoj/login.html", import.meta.url),
      "utf8",
    );
    const requests: string[] = [];
    const http: HttpClient = {
      request: vi.fn(async (_source, url) => {
        requests.push(url);
        if (url.endsWith("/"))
          return {
            status: 200,
            url,
            contentType: "text/html",
            text: fixture,
            headers: new Headers(),
          };
        if (url.includes("page=2"))
          return {
            status: 200,
            url,
            contentType: "text/html",
            text: fixture
              .replace("page=2", "page=2")
              .replace("sample_user", "sample_user"),
            headers: new Headers(),
          };
        return {
          status: 200,
          url,
          contentType: "text/html",
          text: fixture,
          headers: new Headers(),
        };
      }),
    };
    const result = await qojAdapter.fetchRecent({
      account: {
        accountId: "account-1",
        source: "qoj",
        identifier: "sample_user",
        enabled: true,
        authMode: "browser-session",
      },
      limit: 3,
      signal: new AbortController().signal,
      now: 1,
      requestId: "request-1",
      http,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain("page=2");
    expect(result.records).toHaveLength(3);
    expect(result.account.providerAccountKey).toBe("sample_user");
    expect(loginPage).toContain("username");
  });

  it("surfaces an authentication failure instead of treating login HTML as empty", async () => {
    const loginPage = readFileSync(
      new URL("../../docs/fixtures/qoj/login.html", import.meta.url),
      "utf8",
    );
    const http: HttpClient = {
      request: vi.fn(async (_source, url) => ({
        status: 200,
        url: "https://qoj.ac/login",
        contentType: "text/html",
        text: loginPage,
        headers: new Headers(),
      })),
    };
    await expect(
      qojAdapter.fetchRecent({
        account: {
          accountId: "account-1",
          source: "qoj",
          identifier: "sample_user",
          enabled: true,
          authMode: "browser-session",
        },
        limit: 10,
        signal: new AbortController().signal,
        now: 1,
        requestId: "request-1",
        http,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AdapterFailure && error.error.kind === "auth_required",
    );
  });
});
