import { describe, expect, it, vi } from "vitest";
import {
  createHttpClient,
  HttpClientError,
} from "../../src/platform/network/http-client";

describe("HttpClient", () => {
  it("rejects URLs outside the source allowlist", async () => {
    await expect(
      createHttpClient().request("codeforces", "https://example.com/data"),
    ).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("allows the explicit AtCoder Problems API opt-in", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      createHttpClient().request(
        "atcoder",
        "https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=test&from_second=0",
        { atcoderProblemsApi: true },
      ),
    ).resolves.toMatchObject({ status: 200 });
    fetchMock.mockRestore();
  });

  it("uses the requested credentials mode and reads allowed responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const response = await createHttpClient().request(
      "luogu",
      "https://www.luogu.com.cn/record/list",
      { credentials: "include" },
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.luogu.com.cn/record/list",
      expect.objectContaining({ credentials: "include", redirect: "error" }),
    );
    fetchMock.mockRestore();
  });

  it("allows same-origin login requests to follow redirects when requested", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>ok</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await createHttpClient().request(
      "hydroj",
      "http://hydro.example.test/login",
      {
        method: "POST",
        credentials: "include",
        followRedirects: true,
        hydroOrigin: "http://hydro.example.test",
      },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://hydro.example.test/login",
      expect.objectContaining({ credentials: "include", redirect: "follow" }),
    );
    fetchMock.mockRestore();
  });

  it("rejects redirects outside the source allowlist", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      status: 200,
      url: "https://example.com/redirected",
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);
    await expect(
      createHttpClient().request(
        "luogu",
        "https://www.luogu.com.cn/record/list",
      ),
    ).rejects.toMatchObject({ code: "invalid_url" });
    fetchMock.mockRestore();
  });

  it("maps timeout and response size limits to typed errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    await expect(
      createHttpClient().request(
        "codeforces",
        "https://codeforces.com/api/user.status",
        { timeoutMs: 1 },
      ),
    ).rejects.toBeInstanceOf(HttpClientError);
    fetchMock.mockRestore();
  });

  it("retries one transient network failure for GET requests", async () => {
    let calls = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("connection reset");
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
    const response = await createHttpClient().request(
      "luogu",
      "https://www.luogu.com.cn/record/list",
    );
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    fetchMock.mockRestore();
  });

  it("retries one 5xx response but never retries a rate limit", async () => {
    let calls = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        calls += 1;
        return new Response(calls === 1 ? "temporary" : "{}", {
          status: calls === 1 ? 503 : 200,
          headers: { "content-type": "application/json" },
        });
      });
    const response = await createHttpClient().request(
      "luogu",
      "https://www.luogu.com.cn/record/list",
    );
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    fetchMock.mockImplementation(async () => {
      calls += 1;
      return new Response("rate limited", { status: 429 });
    });
    const rateLimited = await createHttpClient().request(
      "luogu",
      "https://www.luogu.com.cn/record/list",
    );
    expect(rateLimited.status).toBe(429);
    expect(calls).toBe(3);
    fetchMock.mockRestore();
  });
});
