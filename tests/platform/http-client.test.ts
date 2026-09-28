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
});
