import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserHttpClient } from "../../src/platform/network/browser-http-client";

const cookieApi = vi.hoisted(() => ({
  get: vi.fn(),
  getAll: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.stubGlobal("browser", { cookies: cookieApi });

afterEach(() => {
  vi.restoreAllMocks();
  cookieApi.get.mockReset();
  cookieApi.getAll.mockReset();
  cookieApi.set.mockReset();
  cookieApi.remove.mockReset();
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
      expect.objectContaining({ credentials: "omit" }),
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
  it("uses QOJ's UOJSESSIONID cookie", async () => {
    cookieApi.get.mockResolvedValue({
      name: "UOJSESSIONID",
      value: "session-value",
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await createBrowserHttpClient().request("qoj", "https://qoj.ac/", {
      credentials: "include",
    });

    expect(cookieApi.get).toHaveBeenCalledWith({
      url: "https://qoj.ac/",
      name: "UOJSESSIONID",
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      headers: {
        Cookie: "UOJSESSIONID=session-value",
      },
    });
  });

  it("does not read browser cookies for an explicit Cookie header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await createBrowserHttpClient().request("qoj", "https://qoj.ac/", {
      credentials: "omit",
      headers: { Cookie: "uoj_username=Manual" },
    });

    expect(cookieApi.get).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      headers: { Cookie: "uoj_username=Manual" },
    });
  });

  it("falls back to an included-credentials request when the cookie API is empty", async () => {
    cookieApi.get.mockResolvedValue(null);
    cookieApi.getAll.mockResolvedValue([]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("login", { status: 200 }));

    const result = await createBrowserHttpClient().request(
      "qoj",
      "https://qoj.ac/",
      { credentials: "include" },
    );

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://qoj.ac/",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
