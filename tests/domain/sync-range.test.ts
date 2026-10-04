import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  isWithinSyncWindow,
  resolveSyncWindow,
  validateSyncWindow,
} from "../../src/domain/sync-range";

const now = new Date(2026, 9, 4, 12, 0, 0).getTime();

describe("collection windows", () => {
  it("defaults to 7 days and preserves explicit old end points", () => {
    expect(resolveSyncWindow({ now })).toEqual({
      since: now - 7 * DAY_MS,
      until: now,
    });
    const window = { since: now - 2 * DAY_MS, until: now - DAY_MS };
    expect(resolveSyncWindow({ now, ...window })).toEqual(window);
    expect(resolveSyncWindow({ now, until: now - DAY_MS })).toEqual({
      since: now - 8 * DAY_MS,
      until: now - DAY_MS,
    });
  });

  it("rejects future, inverted, fractional and over-35-day explicit windows", () => {
    for (const window of [
      { since: now, until: now + 1 },
      { since: now, until: now - 1 },
      { since: now - 1.5, until: now },
      { since: now - 35 * DAY_MS - 1, until: now },
      { since: Number.NaN, until: now },
    ]) {
      expect(() => validateSyncWindow(window, now)).toThrow();
    }
  });

  it("keeps saved fixed ranges and advances only the end for custom following ranges", () => {
    const preference = {
      from: now - 2 * DAY_MS,
      to: now - DAY_MS,
      followNow: false,
    };
    expect(resolveSyncWindow({ now, preference })).toEqual({
      since: preference.from,
      until: preference.to,
    });
    expect(
      resolveSyncWindow({
        now,
        preference: { ...preference, followNow: true },
      }),
    ).toEqual({ since: preference.from, until: now });
  });

  it("resolves rolling presets and today to the same bounds as the UI", () => {
    expect(
      resolveSyncWindow({
        now,
        preference: {
          from: now - 2 * DAY_MS,
          to: now - DAY_MS,
          followNow: true,
          preset: 7,
        },
      }),
    ).toEqual({ since: now - 7 * DAY_MS, until: now });
    expect(
      resolveSyncWindow({
        now,
        preference: {
          from: now - 2 * DAY_MS,
          to: now - DAY_MS,
          followNow: true,
          preset: "today",
        },
      }),
    ).toEqual({ since: new Date(2026, 9, 4).getTime(), until: now });
  });

  it("includes both bounds and excludes invalid or out-of-window timestamps", () => {
    const window = { since: 100, until: 200 };
    expect(isWithinSyncWindow(100, window)).toBe(true);
    expect(isWithinSyncWindow(200, window)).toBe(true);
    expect(isWithinSyncWindow(99, window)).toBe(false);
    expect(isWithinSyncWindow(201, window)).toBe(false);
    expect(isWithinSyncWindow(Number.NaN, window)).toBe(false);
  });
});
