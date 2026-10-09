import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserHttpClient } from "../../src/platform/network/browser-http-client";
import { qojAdapter } from "../../src/adapters/qoj";
import { createPaginationRuntime } from "../../src/platform/network/pagination-throttle";
import {
  withCookieScope,
  withTemporaryCookies,
} from "../../src/platform/network/temporary-cookies";
import { deferred } from "../helpers/deferred";

const cookieApi = vi.hoisted(() => ({
  get: vi.fn(),
  getAll: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
vi.stubGlobal("browser", {
  cookies: cookieApi,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cookieApi.get.mockReset();
  cookieApi.getAll.mockReset();
  cookieApi.set.mockReset();
  cookieApi.remove.mockReset();
});

describe("BrowserHttpClient Codeforces cookie metadata", () => {
  it("reads both session scopes and first-party clearance without returning values or writing cookies", async () => {
    const session = {
      name: "JSESSIONID",
      value: "private-session",
      domain: "codeforces.com",
      path: "/",
      hostOnly: true,
      sameSite: "lax",
    };
    cookieApi.getAll.mockImplementation(async (details) =>
      details.partitionKey
        ? [
            {
              name: "cf_clearance",
              value: "private-clearance",
              domain: ".codeforces.com",
              path: "/",
              hostOnly: false,
              sameSite: "no_restriction",
              partitionKey: { topLevelSite: "https://codeforces.com" },
            },
          ]
        : [
            session,
            { ...session, domain: ".codeforces.com", hostOnly: false },
            { ...session, name: "_ga", value: "tracking" },
          ],
    );

    const metadata = await createBrowserHttpClient().getCookieMetadata(
      "codeforces",
      "https://codeforces.com/",
    );
    expect(metadata).toHaveLength(3);
    expect(metadata[0]).toEqual({
      name: "JSESSIONID",
      domain: "codeforces.com",
      path: "/",
      hostOnly: true,
      sameSite: "lax",
    });
    expect(metadata[1]?.domain).toBe(".codeforces.com");
    expect(metadata[2]?.partitionTopLevelSite).toBe("https://codeforces.com");
    expect(JSON.stringify(metadata)).not.toContain("private");
    expect(cookieApi.getAll).toHaveBeenCalledWith({
      url: "https://codeforces.com/",
      partitionKey: {
        topLevelSite: "https://codeforces.com",
        hasCrossSiteAncestor: false,
      },
    });
    expect(cookieApi.set).not.toHaveBeenCalled();
    expect(cookieApi.remove).not.toHaveBeenCalled();
  });

  it("does not inspect an unrelated origin or source", async () => {
    const client = createBrowserHttpClient();
    expect(
      await client.getCookieMetadata("codeforces", "https://evil.example/"),
    ).toEqual([]);
    expect(
      await client.getCookieMetadata("qoj", "https://codeforces.com/"),
    ).toEqual([]);
    expect(cookieApi.getAll).not.toHaveBeenCalled();
  });

  it("does not double-count cookie scopes when the partition filter is ignored", async () => {
    cookieApi.getAll.mockResolvedValue([
      {
        name: "JSESSIONID",
        value: "secret",
        domain: "codeforces.com",
        path: "/",
        hostOnly: true,
        sameSite: "lax",
      },
    ]);
    const metadata = await createBrowserHttpClient().getCookieMetadata(
      "codeforces",
      "https://codeforces.com/",
    );
    expect(metadata).toHaveLength(1);
  });

  it("uses existing browser cookies directly for Codeforces browser-session requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    await createBrowserHttpClient().request(
      "codeforces",
      "https://codeforces.com/",
      { credentials: "include", followRedirects: true },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://codeforces.com/",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(cookieApi.get).not.toHaveBeenCalled();
    expect(cookieApi.set).not.toHaveBeenCalled();
    expect(cookieApi.remove).not.toHaveBeenCalled();
  });
});

describe("BrowserHttpClient manual AtCoder session", () => {
  it("restores the existing AtCoder cookie after a successful request", async () => {
    const existing = {
      name: "REVEL_SESSION",
      value: "existing",
      domain: ".atcoder.jp",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax" as const,
    };
    cookieApi.get.mockResolvedValue(existing);
    cookieApi.set.mockResolvedValue({});
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await createBrowserHttpClient().request(
      "atcoder",
      "https://atcoder.jp/",
      { atcoderSessionCookie: "manual-secret" },
    );

    expect(result.status).toBe(200);
    expect(cookieApi.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ value: "manual-secret" }),
    );
    expect(cookieApi.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ value: "existing", domain: ".atcoder.jp" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://atcoder.jp/",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it("removes the injected cookie when no prior AtCoder cookie exists", async () => {
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set.mockResolvedValue({});
    cookieApi.remove.mockResolvedValue({ url: "https://atcoder.jp/" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await createBrowserHttpClient().request("atcoder", "https://atcoder.jp/", {
      atcoderSessionCookie: "REVEL_SESSION=manual-secret",
    });

    expect(cookieApi.remove).toHaveBeenCalledWith({
      url: "https://atcoder.jp/",
      name: "REVEL_SESSION",
    });
  });

  it("restores the cookie if the request fails", async () => {
    const existing = {
      name: "REVEL_SESSION",
      value: "existing",
      domain: ".atcoder.jp",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax" as const,
    };
    cookieApi.get.mockResolvedValue(existing);
    cookieApi.set.mockResolvedValue({});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("failed"));

    await expect(
      createBrowserHttpClient().request("atcoder", "https://atcoder.jp/", {
        atcoderSessionCookie: "manual-secret",
        method: "POST",
      }),
    ).rejects.toThrow();

    expect(cookieApi.set).toHaveBeenCalledTimes(2);
    expect(cookieApi.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: "existing", domain: ".atcoder.jp" }),
    );
  });

  it("rejects a manual session on the public third-party API", async () => {
    await expect(
      createBrowserHttpClient().request(
        "atcoder",
        "https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=test&from_second=0",
        {
          atcoderSessionCookie: "manual-secret",
          atcoderProblemsApi: true,
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_url" });

    expect(cookieApi.get).not.toHaveBeenCalled();
    expect(cookieApi.set).not.toHaveBeenCalled();
  });

  it("rejects a manual session for another adapter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      createBrowserHttpClient().request(
        "codeforces",
        "https://codeforces.com/api/user.status",
        { atcoderSessionCookie: "manual-secret" },
      ),
    ).rejects.toMatchObject({ code: "invalid_url" });

    expect(cookieApi.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BrowserHttpClient QOJ browser session", () => {
  it("detects a new login without a QOJ tab and prepares the cookie before the first fetch", async () => {
    const sessionCookie = {
      name: "__Host-UOJSESSID",
      value: "logged-in-session",
      domain: "qoj.ac",
      hostOnly: true,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax" as const,
      storeId: "0",
    };
    let loggedIn = false;
    let activeCookie: Record<string, unknown> | null = null;
    cookieApi.getAll.mockImplementation(async () =>
      loggedIn ? [sessionCookie] : [],
    );
    cookieApi.get.mockImplementation(async () =>
      loggedIn ? sessionCookie : null,
    );
    cookieApi.set.mockImplementation(async (details) => {
      if (
        details.name.startsWith("__Host-") &&
        (!details.secure || details.domain || details.path !== "/")
      )
        throw new Error("Cookie prefix rejected");
      activeCookie = details;
      return details;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        if (!loggedIn) {
          return new Response("<title>Login - QOJ</title>");
        }
        // A guest request before cookies.set would replace the server session.
        expect(activeCookie).toMatchObject({
          name: "__Host-UOJSESSID",
          value: "logged-in-session",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "no_restriction",
        });
        expect(activeCookie).not.toHaveProperty("domain");
        return new Response(
          '<ul class="nav"><a class="nav-link dropdown-toggle" href="#" data-toggle="dropdown"><span class="uoj-username" data-rating="1000">Hardy</span></a><a href="/logout?_token=fixture">Logout</a></ul>',
        );
      });
    const http = createBrowserHttpClient();
    const detect = () =>
      qojAdapter.detectBrowserSession!({
        http,
        signal: new AbortController().signal,
        requestId: "session-check",
      });

    expect((await detect()).authenticated).toBe(false);
    loggedIn = true;
    expect(await detect()).toEqual({
      authenticated: true,
      status: "authenticated",
      username: "Hardy",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cookieApi.getAll).toHaveBeenCalledTimes(2);
    expect(activeCookie).toMatchObject({
      value: "logged-in-session",
      httpOnly: true,
      sameSite: "lax",
    });
    expect(cookieApi.remove).not.toHaveBeenCalled();
  });

  it("retains the cookie injection stage without leaking the browser's raw error", async () => {
    cookieApi.getAll.mockResolvedValue([
      { name: "__Host-UOJSESSID", value: "secret-session" },
    ]);
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set.mockRejectedValue(
      new Error("Rejected value: secret-session"),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await qojAdapter.detectBrowserSession!({
      http: createBrowserHttpClient(),
      signal: new AbortController().signal,
      requestId: "injection-check",
    });
    expect(result.authenticated).toBe(false);
    expect(result.diagnostic).toContain("code=cookie-injection");
    expect(result.diagnostic).toContain("cookie=__Host-UOJSESSID");
    expect(result.diagnostic).not.toContain("secret-session");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports cookie-store read failure before sending a potentially anonymous request", async () => {
    cookieApi.getAll.mockRejectedValue(new Error("Permission denied"));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await qojAdapter.detectBrowserSession!({
      http: createBrowserHttpClient(),
      signal: new AbortController().signal,
      requestId: "cookie-read-check",
    });
    expect(result.diagnostic).toContain("cookie-store-read-failed");
    expect(result.diagnostic).toContain("requestId=cookie-read-check");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads only QOJ authentication cookies, including __Host- names", async () => {
    cookieApi.getAll.mockResolvedValue([
      { name: "__Host-UOJSESSID", value: "session" },
      { name: "__Host-UOJREMEMBER", value: "remember" },
      { name: "cf_clearance", value: "clearance" },
      { name: "uoj_remember_token_checksum", value: "checksum" },
      { name: "uoj_locale", value: "zh-cn" },
    ]);

    await expect(
      createBrowserHttpClient().getCookies?.("qoj", "https://qoj.ac/"),
    ).resolves.toEqual({
      "__Host-UOJSESSID": "session",
      "__Host-UOJREMEMBER": "remember",
      cf_clearance: "clearance",
      uoj_remember_token_checksum: "checksum",
    });
    expect(cookieApi.getAll).toHaveBeenCalledWith({ url: "https://qoj.ac/" });
  });

  it("reads the QOJ UOJSESSID from the browser cookie store", async () => {
    cookieApi.get.mockResolvedValue({ name: "UOJSESSID", value: "session" });

    await expect(
      createBrowserHttpClient().getCookie?.(
        "qoj",
        "https://qoj.ac/",
        "UOJSESSID",
      ),
    ).resolves.toBe("session");
    expect(cookieApi.get).toHaveBeenCalledWith({
      url: "https://qoj.ac/",
      name: "UOJSESSID",
    });
  });

  it("uses the browser-managed QOJ cookies for a browser session", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await createBrowserHttpClient().request("qoj", "https://qoj.ac/", {
      credentials: "include",
    });

    expect(cookieApi.get).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it("temporarily injects a manual QOJ Cookie without sending a forbidden header", async () => {
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set.mockResolvedValue({});
    cookieApi.remove.mockResolvedValue({});
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await createBrowserHttpClient().request("qoj", "https://qoj.ac/", {
      credentials: "include",
      qojCookie:
        "uoj_username=Hardy; uoj_username_checksum=username-checksum; uoj_remember_token=remember-token; uoj_remember_token_checksum=token-checksum",
    });

    expect(cookieApi.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "uoj_username",
        value: "Hardy",
        sameSite: "no_restriction",
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
    expect(cookieApi.remove).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://qoj.ac/" }),
    );
  });

  it("keeps __Host-QOJ cookies host-only while making them cross-site usable", async () => {
    cookieApi.get.mockResolvedValue({
      name: "__Host-UOJSESSID",
      value: "old-session",
      domain: "qoj.ac",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax" as const,
      storeId: "1",
    });
    cookieApi.set.mockResolvedValue({});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await createBrowserHttpClient().request("qoj", "https://qoj.ac/", {
      qojCookie: "__Host-UOJSESSID=new-session",
    });

    expect(cookieApi.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: "__Host-UOJSESSID",
        value: "new-session",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "no_restriction",
      }),
    );
    expect(cookieApi.set.mock.calls[0]?.[0]).not.toHaveProperty("domain");
    expect(cookieApi.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        value: "old-session",
        sameSite: "lax",
      }),
    );
  });

  it("waits for manual Cookie restoration before reading a browser session", async () => {
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set.mockResolvedValue({});
    const { promise: restoring, resolve: restorationStarted } =
      deferred<void>();
    const { promise: restoreResult, resolve: finishRestore } =
      deferred<object>();
    cookieApi.remove.mockImplementationOnce(() => {
      restorationStarted();
      return restoreResult;
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const http = createBrowserHttpClient();
    const manual = http.request("qoj", "https://qoj.ac/", {
      qojCookie: "UOJSESSID=manual",
    });
    await restoring;
    cookieApi.get.mockResolvedValue({ name: "UOJSESSID", value: "original" });
    const session = http.getCookie("qoj", "https://qoj.ac/", "UOJSESSID");
    await Promise.resolve();
    expect(cookieApi.get).toHaveBeenCalledTimes(1);
    finishRestore({});
    await manual;
    await expect(session).resolves.toBe("original");
    expect(cookieApi.get).toHaveBeenCalledTimes(2);
  });

  it("rejects an empty manual QOJ Cookie before making a request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      createBrowserHttpClient().request("qoj", "https://qoj.ac/submissions", {
        credentials: "include",
        qojCookie: "not-a-cookie",
      }),
    ).rejects.toThrow("QOJ Cookie is invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BrowserHttpClient Codeforces manual session", () => {
  it("temporarily injects the pasted JSESSIONID instead of sending a Cookie header", async () => {
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set.mockResolvedValue({});
    cookieApi.remove.mockResolvedValue({});
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html></html>", { status: 200 }));

    await createBrowserHttpClient().request(
      "codeforces",
      "https://codeforces.com/",
      {
        codeforcesCookie: "JSESSIONID=session; 39ce7=browser-token",
      },
    );

    expect(cookieApi.set).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://codeforces.com/",
        name: "JSESSIONID",
        value: "session",
      }),
    );
    expect(cookieApi.set).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://codeforces.com/",
        name: "39ce7",
        value: "browser-token",
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toBeUndefined();
    expect(cookieApi.remove).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://codeforces.com/",
        name: "JSESSIONID",
      }),
    );
    expect(cookieApi.remove).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://codeforces.com/",
        name: "39ce7",
      }),
    );
  });

  it("rejects a malformed manual Cookie before making a request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      createBrowserHttpClient().request(
        "codeforces",
        "https://codeforces.com/",
        { codeforcesCookie: "not-a-cookie" },
      ),
    ).rejects.toThrow("Codeforces Cookie is invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BrowserHttpClient Hydro manual Cookie", () => {
  it("holds Cookie scope until deferred response-body cancellation settles", async () => {
    vi.useFakeTimers();
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set.mockResolvedValue({});
    cookieApi.remove.mockResolvedValue({});
    const { promise: pendingCancel, resolve: finishCancel } = deferred<void>();
    const cancel = vi.fn(() => pendingCancel);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
      .mockResolvedValueOnce(new Response("browser"));
    const controller = new AbortController();
    const http = createBrowserHttpClient();
    const manual = http.request("hydroj", "https://hydro.body.test/record", {
      hydroOrigin: "https://hydro.body.test",
      headers: { Cookie: "sid=manual" },
      signal: controller.signal,
    });
    const rejected = expect(manual).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const ordinary = http.request(
      "hydroj",
      "https://hydro.body.test/record?page=2",
      { hydroOrigin: "https://hydro.body.test", credentials: "include" },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(cookieApi.remove).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    finishCancel();
    await rejected;
    await expect(ordinary).resolves.toMatchObject({ text: "browser" });
    expect(cookieApi.remove).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps the pagination lock through aborted HTTP and deferred Cookie restoration", async () => {
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set.mockResolvedValue({});
    const { promise: restoring, resolve: restorationStarted } =
      deferred<void>();
    const { promise: restoreResult, resolve: finishRestore } =
      deferred<object>();
    cookieApi.remove.mockImplementationOnce(() => {
      restorationStarted();
      return restoreResult;
    });
    const { promise: requesting, resolve: started } = deferred<void>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            started();
            options?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      )
      .mockImplementationOnce(async () => new Response("next"));
    const controller = new AbortController();
    const pagination = createPaginationRuntime({
      sleep: async () => undefined,
    });
    const http = createBrowserHttpClient();
    const first = pagination.runPage({
      origin: "https://hydro.abort.test",
      signal: controller.signal,
      request: () =>
        http.request("hydroj", "https://hydro.abort.test/record", {
          hydroOrigin: "https://hydro.abort.test",
          headers: { Cookie: "sid=manual" },
          signal: controller.signal,
        }),
    });
    const rejected = expect(first).rejects.toBeDefined();
    await requesting;
    controller.abort();
    await restoring;
    const secondCallback = vi.fn(() =>
      http.request("hydroj", "https://hydro.abort.test/record?page=2", {
        hydroOrigin: "https://hydro.abort.test",
      }),
    );
    const second = pagination.runPage({
      origin: "https://hydro.abort.test",
      signal: new AbortController().signal,
      request: secondCallback,
    });
    await Promise.resolve();
    expect(secondCallback).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    finishRestore({});
    await rejected;
    await expect(second).resolves.toMatchObject({ text: "next" });
    expect(secondCallback).toHaveBeenCalledOnce();
    expect(cookieApi.remove).toHaveBeenCalledOnce();
  });
  it("reports restoration failure after a failed task and releases the origin queue", async () => {
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set.mockResolvedValue({});
    cookieApi.remove
      .mockRejectedValueOnce(new Error("restoration rejected"))
      .mockResolvedValueOnce({});
    const taskFailure = new Error("request failed");
    const origin = "https://hydro.example.test";
    const manual = withCookieScope(origin, () =>
      withTemporaryCookies(
        origin,
        "sid=manual; sid.sig=signature",
        async () => {
          throw taskFailure;
        },
      ),
    );
    const following = withCookieScope(origin, async () => {
      expect(cookieApi.remove).toHaveBeenCalledTimes(2);
      return "next request";
    });
    await expect(manual).rejects.toMatchObject({
      code: "cookie-restoration",
      cookieName: "sid.sig",
    });
    await expect(following).resolves.toBe("next request");
    expect(cookieApi.remove).toHaveBeenLastCalledWith({
      url: `${origin}/`,
      name: "sid",
    });
  });

  it.each([new Error("request failed"), undefined])(
    "preserves the task rejection after successful restoration (%s)",
    async (failure) => {
      cookieApi.get.mockResolvedValue(null);
      cookieApi.set.mockResolvedValue({});
      cookieApi.remove.mockResolvedValue({});
      const task = withTemporaryCookies(
        "https://hydro.example.test",
        "sid=manual",
        async () => {
          throw failure;
        },
      );
      await expect(task).rejects.toBe(failure);
      expect(cookieApi.remove).toHaveBeenCalledTimes(1);
    },
  );

  it("injects both sid fields on an HTTP instance and restores the prior session", async () => {
    cookieApi.get.mockImplementation(async ({ name }) =>
      name === "sid"
        ? {
            name: "sid",
            value: "original",
            domain: "hydro.example.test",
            hostOnly: true,
            path: "/",
            secure: false,
            httpOnly: true,
            sameSite: "lax",
          }
        : null,
    );
    cookieApi.set.mockResolvedValue({});
    cookieApi.remove.mockResolvedValue({});
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    await createBrowserHttpClient().request(
      "hydroj",
      "http://hydro.example.test/record",
      {
        hydroOrigin: "http://hydro.example.test",
        headers: {
          Accept: "text/html",
          Cookie: "sid=manual; sid.sig=signature",
        },
        credentials: "omit",
      },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://hydro.example.test/record",
      expect.objectContaining({
        headers: { Accept: "text/html" },
        credentials: "include",
      }),
    );
    expect(cookieApi.set).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://hydro.example.test/",
        name: "sid",
        value: "manual",
        secure: false,
      }),
    );
    expect(cookieApi.set).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "sid",
        value: "original",
        httpOnly: true,
      }),
    );
    expect(cookieApi.remove).toHaveBeenCalledWith({
      url: "http://hydro.example.test/",
      name: "sid.sig",
    });
  });

  it("restores already injected fields if the second Cookie injection fails", async () => {
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("injection rejected"));
    cookieApi.remove.mockResolvedValue({});
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      createBrowserHttpClient().request(
        "hydroj",
        "https://hydro.example.test/",
        {
          hydroOrigin: "https://hydro.example.test",
          headers: { Cookie: "sid=manual; sid.sig=signature" },
        },
      ),
    ).rejects.toMatchObject({
      code: "cookie-injection",
      cookieName: "sid.sig",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cookieApi.remove).toHaveBeenCalledWith({
      url: "https://hydro.example.test/",
      name: "sid",
    });
  });

  it("reports an empty restoration result and still restores the remaining fields", async () => {
    cookieApi.get.mockImplementation(async ({ name }) => ({
      name,
      value: `original-${name}`,
      hostOnly: true,
      path: "/",
      secure: true,
    }));
    cookieApi.set
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    await expect(
      createBrowserHttpClient().request(
        "hydroj",
        "https://hydro.example.test/",
        {
          hydroOrigin: "https://hydro.example.test",
          headers: { Cookie: "sid=manual; sid.sig=signature" },
        },
      ),
    ).rejects.toThrow("Cookie restoration failed");
    expect(cookieApi.set).toHaveBeenCalledTimes(4);
    expect(cookieApi.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "sid", value: "original-sid" }),
    );
  });

  it.each([true, false])(
    "checks Cookie absence when removal returns null (still present: %s)",
    async (stillPresent) => {
      cookieApi.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          stillPresent ? { name: "sid", value: "manual" } : null,
        );
      cookieApi.set.mockResolvedValue({});
      cookieApi.remove.mockResolvedValue(null);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
      const request = createBrowserHttpClient().request(
        "hydroj",
        "https://hydro.example.test/",
        {
          hydroOrigin: "https://hydro.example.test",
          headers: { Cookie: "sid=manual" },
        },
      );
      if (stillPresent)
        await expect(request).rejects.toThrow("Cookie restoration failed");
      else await expect(request).resolves.toMatchObject({ status: 200 });
    },
  );

  it("holds browser-session requests until manual Cookie restoration finishes", async () => {
    cookieApi.get.mockResolvedValue(null);
    cookieApi.set.mockResolvedValue({});
    cookieApi.remove.mockResolvedValue({});
    const { promise: manualResponse, resolve: release } = deferred<Response>();
    const { promise: manualStarted, resolve: started } = deferred<void>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => {
        started();
        return manualResponse;
      })
      .mockImplementationOnce(async () => {
        expect(cookieApi.remove).toHaveBeenCalledTimes(2);
        return new Response("browser");
      });
    const http = createBrowserHttpClient();
    const manual = http.request("hydroj", "https://hydro.example.test/", {
      hydroOrigin: "https://hydro.example.test",
      headers: { Cookie: "sid=manual; sid.sig=signature" },
    });
    await manualStarted;
    const ordinary = http.request(
      "hydroj",
      "https://hydro.example.test/record",
      { hydroOrigin: "https://hydro.example.test", credentials: "include" },
    );
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response("manual"));
    await Promise.all([manual, ordinary]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
