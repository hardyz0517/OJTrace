import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGINATION_POLICY,
  SOURCE_IDS,
  isPaginationPolicy,
  paginationDelayMs,
  resolvePaginationPolicy,
  sanitizePaginationPolicies,
} from "../../src/domain";

describe("pagination policy", () => {
  it("keeps every source's existing defaults and returns immutable independent snapshots", () => {
    const override = { intervalMs: 3_000, jitterMs: 1_000 };
    for (const source of SOURCE_IDS)
      expect(resolvePaginationPolicy(source)).toEqual(
        DEFAULT_PAGINATION_POLICY,
      );
    const snapshot = resolvePaginationPolicy("codeforces", {
      codeforces: override,
    });
    override.intervalMs = 5_000;
    expect(snapshot).toEqual({ intervalMs: 3_000, jitterMs: 1_000 });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(resolvePaginationPolicy("qoj", { codeforces: override })).toEqual(
      DEFAULT_PAGINATION_POLICY,
    );
  });

  it.each([
    { intervalMs: 1_500, jitterMs: 0 },
    { intervalMs: 1_500, jitterMs: 500 },
    { intervalMs: 6_000, jitterMs: 5_000 },
    { intervalMs: 600_000, jitterMs: 599_000 },
  ])("accepts valid interval and jitter boundaries: %j", (policy) => {
    expect(isPaginationPolicy(policy)).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { intervalMs: 1_400, jitterMs: 0 },
    { intervalMs: 600_100, jitterMs: 0 },
    { intervalMs: 1_500, jitterMs: 600 },
    { intervalMs: 600_000, jitterMs: 599_100 },
    { intervalMs: 1_500, jitterMs: -100 },
    { intervalMs: 1_550, jitterMs: 0 },
    { intervalMs: 1_500, jitterMs: 50 },
    { intervalMs: NaN, jitterMs: 0 },
    { intervalMs: Infinity, jitterMs: 0 },
    { intervalMs: "1500", jitterMs: 500 },
    { intervalMs: 1_500, jitterMs: NaN },
    { intervalMs: 1_500, jitterMs: 500, unexpected: true },
  ])("rejects invalid policies: %j", (policy) => {
    expect(isPaginationPolicy(policy)).toBe(false);
  });

  it("repairs each corrupt source independently and ignores unknown keys", () => {
    const repaired = sanitizePaginationPolicies({
      codeforces: { intervalMs: 3_000, jitterMs: 1_000 },
      luogu: { intervalMs: 0, jitterMs: 0 },
      qoj: { intervalMs: 2_000 },
      unknown: { intervalMs: 2_000, jitterMs: 0 },
    });
    expect(repaired).toEqual({
      codeforces: { intervalMs: 3_000, jitterMs: 1_000 },
    });
    expect(resolvePaginationPolicy("luogu", repaired)).toEqual(
      DEFAULT_PAGINATION_POLICY,
    );
    expect(sanitizePaginationPolicies(null)).toBeUndefined();
    expect(sanitizePaginationPolicies([])).toBeUndefined();
    expect(sanitizePaginationPolicies({ codeforces: null })).toBeUndefined();
    expect(
      sanitizePaginationPolicies(
        Object.create({ codeforces: DEFAULT_PAGINATION_POLICY }),
      ),
    ).toBeUndefined();
  });

  it("computes uniform jitter, clamps samples and supports disabling jitter", () => {
    const policy = { intervalMs: 3_000, jitterMs: 1_000 };
    expect(
      [0, 0.5, 1].map((sample) => paginationDelayMs(policy, sample)),
    ).toEqual([2_000, 3_000, 4_000]);
    expect(paginationDelayMs(policy, -1)).toBe(2_000);
    expect(paginationDelayMs(policy, 2)).toBe(4_000);
    expect(paginationDelayMs(policy, NaN)).toBe(3_000);
    expect(paginationDelayMs(policy, Infinity)).toBe(3_000);
    expect(paginationDelayMs({ intervalMs: 2_000, jitterMs: 0 }, 0)).toBe(
      2_000,
    );
    expect(
      [0, 0.5, 1].map((sample) =>
        paginationDelayMs({ intervalMs: 600_000, jitterMs: 599_000 }, sample),
      ),
    ).toEqual([1_000, 600_000, 1_199_000]);
  });
});
