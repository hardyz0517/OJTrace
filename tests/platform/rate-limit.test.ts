import { describe, expect, it, vi } from "vitest";
import {
  RateLimitError,
  createRateLimitRegistry,
  parseRetryAfter,
  type RateLimitEntry,
} from "../../src/platform/network/rate-limit";
import { deferred } from "../helpers/deferred";

describe("origin rate limit registry", () => {
  it("parses delta seconds and HTTP dates", () => {
    expect(parseRetryAfter("1.5", 0)).toBe(1_500);
    expect(
      parseRetryAfter(
        "Wed, 21 Oct 2015 07:28:00 GMT",
        Date.parse("Wed, 21 Oct 2015 07:27:00 GMT"),
      ),
    ).toBe(60_000);
    expect(parseRetryAfter("bad", 0)).toBeUndefined();
  });

  it("isolates origins and keeps the longest cooldown", () => {
    let now = 1_000;
    const registry = createRateLimitRegistry({
      now: () => now,
      defaultCooldownMs: 2_000,
    });
    expect(registry.record429("https://one.test/path", "1")).toBe(1_000);
    expect(registry.record429("https://one.test", "5")).toBe(5_000);
    expect(registry.getRetryAfterMs("https://two.test")).toBe(0);
    expect(() => registry.assertAvailable("https://one.test")).toThrow(
      RateLimitError,
    );
    now = 6_000;
    expect(registry.getRetryAfterMs("https://one.test")).toBe(0);
  });

  it("preserves in-memory protection if persistence fails", async () => {
    const registry = createRateLimitRegistry({
      storage: {
        load: async () => [],
        save: async () => {
          throw new Error("storage unavailable");
        },
      },
    });
    registry.record429("https://one.test", "10");
    await registry.flush();
    expect(registry.getRetryAfterMs("https://one.test")).toBeGreaterThan(0);
  });

  it("shares one restore and merges persisted cooldown with newer memory", async () => {
    const { promise: pending, resolve: finishLoad } =
      deferred<RateLimitEntry[]>();
    const load = vi.fn(() => pending);
    const save = vi.fn(async () => undefined);
    const registry = createRateLimitRegistry({
      now: () => 1_000,
      storage: { load, save },
    });
    const first = registry.ready();
    const second = registry.ready();
    expect(first).toBe(second);
    registry.record429("https://one.test", "20");
    finishLoad([
      { origin: "https://one.test", blockedUntil: 5_000 },
      { origin: "https://two.test", blockedUntil: 9_000 },
    ]);
    await registry.flush();
    expect(load).toHaveBeenCalledOnce();
    expect(registry.getRetryAfterMs("https://one.test")).toBe(20_000);
    expect(registry.getRetryAfterMs("https://two.test")).toBe(8_000);
    expect(save).toHaveBeenCalledWith([
      { origin: "https://one.test", blockedUntil: 21_000 },
      { origin: "https://two.test", blockedUntil: 9_000 },
    ]);
  });

  it("serializes deferred persistence writes so an old snapshot cannot win", async () => {
    const { promise: pending, resolve: release } = deferred<void>();
    const { promise: firstStarted, resolve: started } = deferred<void>();
    const persisted: RateLimitEntry[][] = [];
    const save = vi.fn(async (entries: readonly RateLimitEntry[]) => {
      if (persisted.length === 0) {
        started();
        await pending;
      }
      persisted.push(entries.map((entry) => ({ ...entry })));
    });
    const registry = createRateLimitRegistry({
      now: () => 1_000,
      storage: { load: async () => [], save },
    });
    registry.record429("https://one.test", "5");
    await firstStarted;
    registry.record429("https://one.test", "20");
    await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();
    release();
    await registry.flush();
    expect(persisted).toEqual([
      [{ origin: "https://one.test", blockedUntil: 6_000 }],
      [{ origin: "https://one.test", blockedUntil: 21_000 }],
    ]);
  });

  it("reports restore failure once and still enforces future limits", async () => {
    const onStorageError = vi.fn();
    const registry = createRateLimitRegistry({
      now: () => 1_000,
      storage: {
        load: async () => {
          throw new Error("unavailable");
        },
        save: async () => undefined,
      },
      onStorageError,
    });
    await Promise.all([registry.ready(), registry.ready()]);
    registry.record429("https://one.test", "2");
    await registry.flush();
    expect(onStorageError).toHaveBeenCalledOnce();
    expect(() => registry.assertAvailable("https://one.test")).toThrow(
      RateLimitError,
    );
  });
});
