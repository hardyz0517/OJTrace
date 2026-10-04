import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPaginationRuntime,
  sleepForPagination,
} from "../../src/platform/network/pagination-throttle";
import { createRateLimitRegistry } from "../../src/platform/network/rate-limit";

afterEach(() => vi.useRealTimers());

describe("pagination runtime", () => {
  it("uses the production delay before dispatch and leaves no final delay timer", async () => {
    vi.useFakeTimers();
    const runtime = createPaginationRuntime({ random: () => 0.5 });
    const events: number[] = [];
    const page = (number: number) =>
      runtime.runPage({
        origin: "https://one.test",
        signal: new AbortController().signal,
        request: async () => {
          events.push(number);
          return number;
        },
      });
    await page(1);
    const second = page(2);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(events).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe(2);
    expect(events).toEqual([1, 2]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, 0.5, 1])(
    "uses the exact jitter boundaries for random=%s",
    async (random) => {
      const sleep = vi.fn(async (_milliseconds: number) => undefined);
      const runtime = createPaginationRuntime({ random: () => random, sleep });
      const page = () =>
        runtime.runPage({
          origin: "https://one.test",
          signal: new AbortController().signal,
          request: async () => undefined,
        });
      await page();
      await page();
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep.mock.calls[0]?.[0]).toBe(1_000 + random * 1_000);
    },
  );
  it("dispatches one origin serially and waits 1-2 seconds after the first page", async () => {
    const delays: number[] = [];
    const runtime = createPaginationRuntime({
      random: () => 0.5,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    const calls: number[] = [];
    await runtime.runPage({
      origin: "https://example.test/",
      signal: new AbortController().signal,
      request: async () => {
        calls.push(1);
        return 1;
      },
    });
    await runtime.runPage({
      origin: "https://example.test/path",
      signal: new AbortController().signal,
      request: async () => {
        calls.push(2);
        return 2;
      },
    });
    expect(calls).toEqual([1, 2]);
    expect(delays).toEqual([1_500]);
  });

  it("does not release the queue while a callback is still running", async () => {
    let release!: () => void;
    const running = new Promise<void>((resolve) => (release = resolve));
    const events: string[] = [];
    const runtime = createPaginationRuntime({
      sleep: async () => undefined,
    });
    const first = runtime.runPage({
      origin: "https://example.test",
      signal: new AbortController().signal,
      request: async () => {
        events.push("first-start");
        await running;
        events.push("first-end");
        return 1;
      },
    });
    const second = runtime.runPage({
      origin: "https://example.test",
      signal: new AbortController().signal,
      request: async () => {
        events.push("second");
        return 2;
      },
    });
    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("cancels a queued page without running its callback", async () => {
    let release!: () => void;
    const running = new Promise<void>((resolve) => (release = resolve));
    const runtime = createPaginationRuntime({ sleep: async () => undefined });
    const controller = new AbortController();
    const first = runtime.runPage({
      origin: "https://example.test",
      signal: new AbortController().signal,
      request: async () => {
        await running;
        return 1;
      },
    });
    const second = runtime.runPage({
      origin: "https://example.test",
      signal: controller.signal,
      request: async () => 2,
    });
    controller.abort();
    await expect(second).rejects.toBeDefined();
    release();
    await expect(first).resolves.toBe(1);
  });

  it("waits for active callback cleanup after abort before dispatching the next page", async () => {
    let release!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => (release = resolve));
    const hasStarted = new Promise<void>((resolve) => (started = resolve));
    const controller = new AbortController();
    const next = vi.fn(async () => 2);
    const runtime = createPaginationRuntime({ sleep: async () => undefined });
    const first = runtime.runPage({
      origin: "https://one.test",
      signal: controller.signal,
      request: async () => {
        started();
        await running;
        return 1;
      },
    });
    await hasStarted;
    const firstRejected = expect(first).rejects.toBeDefined();
    controller.abort();
    const second = runtime.runPage({
      origin: "https://one.test",
      signal: new AbortController().signal,
      request: next,
    });
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled();
    release();
    await firstRejected;
    await expect(second).resolves.toBe(2);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows independent origins to run while another callback is active", async () => {
    let release!: () => void;
    const running = new Promise<void>((resolve) => (release = resolve));
    const runtime = createPaginationRuntime();
    const first = runtime.runPage({
      origin: "https://one.test",
      signal: new AbortController().signal,
      request: async () => {
        await running;
        return 1;
      },
    });
    await expect(
      runtime.runPage({
        origin: "https://two.test",
        signal: new AbortController().signal,
        request: async () => 2,
      }),
    ).resolves.toBe(2);
    release();
    await first;
  });

  it("checks cooldown again after the page delay and never dispatches blocked pages", async () => {
    const registry = createRateLimitRegistry({ now: () => 1_000 });
    const runtime = createPaginationRuntime({
      rateLimits: registry,
      sleep: async () => {
        registry.record429("https://one.test", "10");
      },
    });
    await runtime.runPage({
      origin: "https://one.test",
      signal: new AbortController().signal,
      request: async () => 1,
    });
    const request = vi.fn(async () => 2);
    await expect(
      runtime.runPage({
        origin: "https://one.test",
        signal: new AbortController().signal,
        request,
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(request).not.toHaveBeenCalled();
  });

  it("cancels real delay timers and retains origin history between requests", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = sleepForPagination(1_500, controller.signal);
    const rejected = expect(waiting).rejects.toBeDefined();
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    let now = 0;
    const sleep = vi.fn(async () => undefined);
    const runtime = createPaginationRuntime({
      now: () => now,
      sleep,
      idleTtlMs: 10_000,
    });
    const page = () =>
      runtime.runPage({
        origin: "https://one.test",
        signal: new AbortController().signal,
        request: async () => 1,
      });
    await page();
    now = 9_999;
    await page();
    expect(sleep).toHaveBeenCalledOnce();
    now += 10_000;
    await page();
    expect(sleep).toHaveBeenCalledOnce();
  });
});
