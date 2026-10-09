import { immediatePagination } from "../helpers/fetch-input";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../src/domain";
import { AdapterFailure } from "../../src/domain/errors";
import { qojAdapter, qojCookieFromCredentials } from "../../src/adapters/qoj";
import { normalizeQOJRecord } from "../../src/adapters/qoj/normalizer";
import {
  isQOJCloudflarePage,
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
const serverFixture = readFileSync(
  new URL(
    "../../docs/fixtures/qoj/server-submissions-page.html",
    import.meta.url,
  ),
  "utf8",
);

describe("QOJ adapter", () => {
  it.each([undefined, "0", "1"])(
    "reads the server-rendered navbar username with data-link=%s before JS runs",
    (link) => {
      const page =
        link === undefined
          ? serverFixture
          : serverFixture.replace(
              'data-rating="1000"',
              `data-rating="1000" data-link="${link}"`,
            );
      expect(parseQOJIdentity(page)).toBe("Hardy");
      expect(
        parseQOJRecordPage(page, "https://qoj.ac/submissions").username,
      ).toBe("Hardy");
    },
  );

  it("continues past a logout list with no identity to the account navigation", () => {
    expect(
      parseQOJIdentity(
        `<ul><li><a href="/logout">Logout</a></li></ul>${liveFixture}`,
      ),
    ).toBe("Hardy");
  });

  it("rejects table usernames and script markup as a logged-in identity", () => {
    const page =
      '<ul class="nav"><a href="/logout">Logout</a></ul>' +
      "<script>const example = '<span class=\"uoj-username\">ScriptUser</span>';</script>" +
      '<table><tr><td><span class="uoj-username">TableUser</span></td></tr></table>';
    expect(parseQOJIdentity(page)).toBeUndefined();
    expect(
      parseQOJIdentity(serverFixture.replaceAll("/logout", "/login")),
    ).toBeUndefined();
  });

  it("detects and fetches the current account from HTML before QOJ executes JavaScript", async () => {
    const http: HttpClient = {
      request: vi.fn(async (_source, url) => ({
        status: 200,
        url,
        contentType: "text/html",
        text: serverFixture,
        headers: new Headers(),
      })),
      getCookies: vi.fn(async () => ({
        "__Host-UOJSESSID": "test-session",
        "__Host-UOJREMEMBER": "test-remember",
      })),
    };
    const input = {
      signal: new AbortController().signal,
      requestId: "raw-server-html",
      http,
    };
    expect(await qojAdapter.detectBrowserSession!(input)).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "Hardy",
    });
    const recent = await qojAdapter.fetchRecent({
      since: 0,
      until: Number.MAX_SAFE_INTEGER,
      pagination: immediatePagination(),
      ...input,
      account: {
        accountId: "account-1",
        source: "qoj",
        enabled: true,
        authMode: "browser-session",
      },
      limit: 2,
      now: 1,
    });
    expect(recent.account.providerAccountKey).toBe("Hardy");
    expect(recent.records).toHaveLength(2);
    expect(
      recent.records.every((row) => row.providerAccountKey === "Hardy"),
    ).toBe(true);
  });

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
        '<ul class="nav"><li><a class="uoj-username" href="//qoj.ac/user/profile/Hardy">Hardy</a><ul class="dropdown-menu"><li>menu</li></ul></li><li><a href="//qoj.ac/logout?_token=test">Logout</a></li></ul>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<a class="uoj-username" href="//qoj.ac/user/profile/top_user">top_user</a>',
      ),
    ).toBeUndefined();
    expect(
      parseQOJIdentity(
        '<table><tr><td><a class="uoj-username" href="//qoj.ac/user/profile/Qingyu">Qingyu</a></td></tr></table><ul class="nav"><li><a class="uoj-username" href="//qoj.ac/user/profile/Hardy">Hardy</a></li><li><a href="//qoj.ac/logout?_token=test">Logout</a></li></ul>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<table><tr><td><span class="uoj-username" data-link="0">Qingyu</span></td></tr></table><ul class="nav"><li><span class="uoj-username" data-link="0">Hardy</span></li><li><a href="//qoj.ac/logout?_token=test">Logout</a></li></ul>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<table><tr><td><a class="uoj-username" href="//qoj.ac/user/profile/Qingyu">Qingyu</a></td></tr></table><a class="nav-link dropdown-toggle" data-toggle="dropdown" href="#"><a class="uoj-username" href="//qoj.ac/user/profile/Hardy">Hardy</a></a><a href="//qoj.ac/logout?_token=test">Logout</a>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<table><tr><td><span class="uoj-username" data-link="0">Qingyu</span></td></tr></table><a class="nav-link dropdown-toggle" data-toggle="dropdown" href="#"><span class="uoj-username" data-link="0">Hardy</span></a><a href="//qoj.ac/logout?_token=test">Logout</a>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<a class="nav-link dropdown-toggle" data-toggle="dropdown" href="#"><a class="uoj-username" href="/user/profile/Hardy">Hardy</a></a><a href="/logout?_token=test">Logout</a>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<div class="site-header"><span class="uoj-username">Hardy</span><a href="/logout">Logout</a></div><table><tr><td><a class="uoj-username" href="/user/profile/Qingyu">Qingyu</a></td></tr></table>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<div class="site-header"><a class="uoj-username" href="#">Hardy</a><a href="/logout">Logout</a></div>',
      ),
    ).toBe("Hardy");
    expect(
      parseQOJIdentity(
        '<table><tr><td><a class="uoj-username" href="//qoj.ac/user/profile/Qingyu">Qingyu</a></td></tr></table><a href="//qoj.ac/logout?_token=test">Logout</a>',
      ),
    ).toBeUndefined();
    expect(
      parseQOJIdentity(
        '<ul class="nav"><a class="uoj-username" href="//qoj.ac/user/profile/Hardy">Qingyu</a><a href="//qoj.ac/logout?_token=test">Logout</a></ul>',
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
            url: "https://qoj.ac/submissions",
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

  it("recognizes the Cloudflare challenge returned before the QOJ page", () => {
    expect(
      isQOJCloudflarePage(
        "<title>Just a moment...</title> Enable JavaScript and cookies to continue",
      ),
    ).toBe(true);
    expect(isQOJCloudflarePage(liveFixture)).toBe(false);
  });

  it("accepts an authenticated QOJ page with Cloudflare's ordinary JS detection script", async () => {
    const page = `${liveFixture}<script>(function(){var s=document.createElement('script');s.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';})();</script>`;
    expect(isQOJCloudflarePage(page)).toBe(false);
    const result = await qojAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "normal-cloudflare-script",
      http: {
        async request() {
          return {
            status: 200,
            url: "https://qoj.ac/submissions",
            contentType: "text/html",
            text: page,
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

  it("recognizes a managed challenge and ignores challenge words inside normal scripts", () => {
    expect(
      isQOJCloudflarePage(
        '<html><script>window._cf_chl_opt = { cType: "managed" };</script></html>',
      ),
    ).toBe(true);
    expect(
      isQOJCloudflarePage(
        `${liveFixture}<script>const messages = ['Just a moment', 'Enable JavaScript and cookies to continue'];</script>`,
      ),
    ).toBe(false);
  });

  it("uses UOJSESSID as the session check even without a username cookie", async () => {
    const result = await qojAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http: {
        async request() {
          return {
            status: 200,
            url: "https://qoj.ac/submissions",
            contentType: "text/html",
            text: liveFixture,
            headers: new Headers(),
          };
        },
        async getCookie(_source, _url, name) {
          return name === "UOJSESSID" ? "session-value" : undefined;
        },
      },
    });
    expect(result).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "Hardy",
    });
  });

  it("accepts an authenticated response even when the cookie API has no session value", async () => {
    const result = await qojAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http: {
        async request() {
          return {
            status: 200,
            url: "https://qoj.ac/submissions",
            contentType: "text/html",
            text: liveFixture,
            headers: new Headers(),
          };
        },
        async getCookie() {
          return undefined;
        },
      },
    });
    expect(result).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "Hardy",
    });
  });

  it("reports the response stage and cookie names when detection fails", async () => {
    const result = await qojAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http: {
        async request() {
          return {
            status: 200,
            url: "https://qoj.ac/login",
            contentType: "text/html",
            text: readFileSync(
              new URL("../../docs/fixtures/qoj/login.html", import.meta.url),
              "utf8",
            ),
            headers: new Headers(),
          };
        },
        async getCookies() {
          return { "__Host-UOJSESSID": "session-value" };
        },
      },
    });
    expect(result.status).toBe("unauthenticated");
    expect(result.diagnostic).toContain("qoj-login-page");
    expect(result.diagnostic).toContain("cookies=__Host-UOJSESSID");
    expect(result.diagnostic).not.toContain("session-value");
  });

  it("uses the new __Host-UOJSESSID cookie on the first background request", async () => {
    const requests: Array<Parameters<HttpClient["request"]>[2]> = [];
    const http: HttpClient = {
      request: vi.fn(async (_source, _url, options) => {
        requests.push(options);
        if (options?.qojCookie) {
          return {
            status: 200,
            url: "https://qoj.ac/submissions",
            contentType: "text/html",
            text: liveFixture,
            headers: new Headers(),
          };
        }
        return {
          status: 200,
          url: "https://qoj.ac/login",
          contentType: "text/html",
          text: readFileSync(
            new URL("../../docs/fixtures/qoj/login.html", import.meta.url),
            "utf8",
          ),
          headers: new Headers(),
        };
      }),
      getCookie: vi.fn(async (_source, _url, name) =>
        name === "__Host-UOJSESSID" ? "session-value" : undefined,
      ),
    };
    const result = await qojAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http,
    });
    expect(result).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "Hardy",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      qojCookie: "__Host-UOJSESSID=session-value",
    });
  });

  it("includes QOJ and clearance cookies before any Cloudflare response", async () => {
    const requests: Array<Parameters<HttpClient["request"]>[2]> = [];
    const http: HttpClient = {
      request: vi.fn(async (_source, _url, options) => {
        requests.push(options);
        if (options?.qojCookie?.includes("cf_clearance=clearance")) {
          return {
            status: 200,
            url: "https://qoj.ac/submissions",
            contentType: "text/html",
            text: liveFixture,
            headers: new Headers(),
          };
        }
        return {
          status: 403,
          url: "https://qoj.ac/submissions",
          contentType: "text/html",
          text: "<title>Just a moment...</title> Enable JavaScript and cookies to continue",
          headers: new Headers(),
        };
      }),
      async getCookies() {
        return {
          "__Host-UOJSESSID": "session-value",
          cf_clearance: "clearance",
        };
      },
    };
    const result = await qojAdapter.detectBrowserSession!({
      signal: new AbortController().signal,
      requestId: "request",
      http,
    });
    expect(result).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "Hardy",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.qojCookie).toContain("__Host-UOJSESSID=session-value");
    expect(requests[0]?.qojCookie).toContain("cf_clearance=clearance");
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
    expect(qojCookieFromCredentials({ UOJSESSID: "session-value" })).toBe(
      "UOJSESSID=session-value",
    );
    expect(
      qojCookieFromCredentials({ "__Host-UOJSESSID": "session-value" }),
    ).toBe("__Host-UOJSESSID=session-value");
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
      since: 0,
      until: Number.MAX_SAFE_INTEGER,
      pagination: immediatePagination(),
      account: {
        accountId: "account-1",
        source: "qoj",
        identifier: "",
        enabled: true,
        authMode: "manual-cookie",
      },
      credentials: { cookie: "uoj_username=Hardy; uoj_remember_token=token" },
      limit: 2,
      signal: new AbortController().signal,
      now: 1,
      requestId: "request-1",
      http,
    });
    expect(result.account.providerAccountKey).toBe("Hardy");
    expect(result.records).toHaveLength(2);
    expect(requests[0]?.options).toMatchObject({
      credentials: "include",
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
      qojCookie: "uoj_username=Hardy; uoj_remember_token=token",
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
      since: 0,
      until: Number.MAX_SAFE_INTEGER,
      pagination: immediatePagination(),
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
    expect(result.records).toHaveLength(2);
    expect(result.coverage.outcome).toEqual({
      status: "partial",
      reasons: ["pagination-repeated"],
    });
    expect(result.account.providerAccountKey).toBe("sample_user");
    expect(loginPage).toContain("username");
  });

  it("surfaces an authentication failure instead of treating login HTML as empty", async () => {
    const loginPage = readFileSync(
      new URL("../../docs/fixtures/qoj/login.html", import.meta.url),
      "utf8",
    );
    const http: HttpClient = {
      request: vi.fn(async () => ({
        status: 200,
        url: "https://qoj.ac/login",
        contentType: "text/html",
        text: loginPage,
        headers: new Headers(),
      })),
    };
    await expect(
      qojAdapter.fetchRecent({
        since: 0,
        until: Number.MAX_SAFE_INTEGER,
        pagination: immediatePagination(),
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

  it("rejects records when the authenticated navbar belongs to another account", async () => {
    const http: HttpClient = {
      request: vi.fn(async (_source, url) => ({
        status: 200,
        url,
        contentType: "text/html",
        text: liveFixture.replaceAll("Hardy", "Qingyu"),
        headers: new Headers(),
      })),
    };
    await expect(
      qojAdapter.fetchRecent({
        since: 0,
        until: Number.MAX_SAFE_INTEGER,
        pagination: immediatePagination(),
        account: {
          accountId: "account-1",
          source: "qoj",
          identifier: "Hardy",
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

  it("uses the browser username cookie when submission rows contain other users", async () => {
    const http: HttpClient = {
      request: vi.fn(async (_source, url) => ({
        status: 200,
        url,
        contentType: "text/html",
        text: liveFixture.replaceAll("Hardy", "Qingyu"),
        headers: new Headers(),
      })),
      getCookie: vi.fn(async (_source, _url, name) =>
        name === "uoj_username" ? "Hardy" : undefined,
      ),
    };
    const result = await qojAdapter.fetchRecent({
      since: 0,
      until: Number.MAX_SAFE_INTEGER,
      pagination: immediatePagination(),
      account: {
        accountId: "account-1",
        source: "qoj",
        identifier: "Hardy",
        enabled: true,
        authMode: "browser-session",
      },
      limit: 2,
      signal: new AbortController().signal,
      now: 1,
      requestId: "request-1",
      http,
    });
    expect(result.account.providerAccountKey).toBe("Hardy");
  });

  it("rejects an unfiltered submissions response", async () => {
    const http: HttpClient = {
      request: vi.fn(async () => ({
        status: 200,
        url: "https://qoj.ac/submissions",
        contentType: "text/html",
        text: liveFixture,
        headers: new Headers(),
      })),
    };
    await expect(
      qojAdapter.fetchRecent({
        since: 0,
        until: Number.MAX_SAFE_INTEGER,
        pagination: immediatePagination(),
        account: {
          accountId: "account-1",
          source: "qoj",
          identifier: "Hardy",
          enabled: true,
          authMode: "browser-session",
        },
        limit: 2,
        signal: new AbortController().signal,
        now: 1,
        requestId: "request-1",
        http,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AdapterFailure && error.error.kind === "parse_failed",
    );
  });
});
