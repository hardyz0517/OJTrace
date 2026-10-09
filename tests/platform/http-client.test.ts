import { describe, expect, it, vi } from "vitest";
import {
  createHttpClient,
  HttpClientError,
} from "../../src/platform/network/http-client";
import { createRateLimitRegistry } from "../../src/platform/network/rate-limit";
import { deferred } from "../helpers/deferred";

describe("HttpClient", () => {
  it("waits for deferred stream cancellation before settling a body timeout", async () => {
    vi.useFakeTimers();
    const { promise: pendingCancel, resolve: finishCancel } = deferred<void>();
    const cancel = vi.fn(() => pendingCancel);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(new ReadableStream({ cancel })));
    let settled = false;
    try {
      const request = createHttpClient().request(
        "luogu",
        "https://www.luogu.com.cn/record/list",
        { timeoutMs: 10 },
      );
      const observed = request.then(
        () => {
          settled = true;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      await vi.advanceTimersByTimeAsync(10);
      expect(cancel).toHaveBeenCalledOnce();
      expect(settled).toBe(false);
      finishCancel();
      await expect(observed).resolves.toMatchObject({ code: "timeout" });
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      finishCancel();
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });
  it("blocks later requests as soon as 429 headers arrive, before the body finishes", async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const { promise: reading, resolve: bodyReadStarted } = deferred<void>();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
      },
      pull() {
        bodyReadStarted();
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        status: 429,
        headers: { "retry-after": "10" },
      }),
    );
    const registry = createRateLimitRegistry({ now: () => 100 });
    const http = createHttpClient({ rateLimits: registry });
    try {
      const first = http.request(
        "luogu",
        "https://www.luogu.com.cn/record/list",
      );
      await reading;
      // Pull can begin during stream construction, so wait until dispatch has
      // accepted the response headers, without allowing its body to finish.
      await vi.waitFor(() =>
        expect(registry.getRetryAfterMs("https://www.luogu.com.cn")).toBe(
          10_000,
        ),
      );
      await expect(
        http.request("luogu", "https://www.luogu.com.cn/record/list?page=2"),
      ).rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 10_000 });
      expect(fetchMock).toHaveBeenCalledOnce();
      body.close();
      await expect(first).resolves.toMatchObject({ status: 429 });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("checks origin cooldown before each physical retry", async () => {
    const registry = createRateLimitRegistry();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        registry.record429("https://www.luogu.com.cn", "10");
        throw new TypeError("temporary network failure");
      });
    try {
      await expect(
        createHttpClient({ rateLimits: registry }).request(
          "luogu",
          "https://www.luogu.com.cn/record/list",
        ),
      ).rejects.toMatchObject({ code: "rate_limited" });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("preserves caller abort reasons during body reads without retry", async () => {
    const { promise: reading, resolve: started } = deferred<void>();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          pull() {
            started();
          },
        }),
      ),
    );
    const controller = new AbortController();
    const reason = { kind: "deadline" };
    try {
      const promise = createHttpClient().request(
        "luogu",
        "https://www.luogu.com.cn/record/list",
        { signal: controller.signal },
      );
      const rejected = expect(promise).rejects.toBe(reason);
      await reading;
      controller.abort(reason);
      await rejected;
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      fetchMock.mockRestore();
    }
  });
  it("cancels an oversized binary stream without buffering its entire body", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16));
      },
      cancel,
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(stream));
    try {
      await expect(
        createHttpClient().request(
          "hydroj",
          "https://binary.example.org/favicon.ico",
          {
            hydroOrigin: "https://binary.example.org",
            maxBytes: 8,
            responseType: "bytes",
          },
        ),
      ).rejects.toMatchObject({ code: "response_too_large" });
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });
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
