import { describe, expect, it } from "vitest";
import {
  parseRangeDateTime,
  quickDateTimeRange,
  resolveDateTimeRange,
} from "../../entrypoints/shared/date-time-range";

describe("date/time range boundaries", () => {
  it("keeps exact rolling windows for the existing recent-days filter", () => {
    const now = new Date(2026, 9, 1, 23, 48).getTime();
    const value = quickDateTimeRange(30, true, now);
    expect(value.from).toBe(now - 30 * 86_400_000);
    const later = now + 180_000;
    expect(resolveDateTimeRange(value, later)).toEqual({
      ...value,
      from: later - 30 * 86_400_000,
      to: later,
    });
  });

  it("freezes both bounds when following is disabled", () => {
    const value = quickDateTimeRange(7, false, 1_800_000_000_000);
    expect(resolveDateTimeRange(value, value.to + 100_000)).toEqual(value);
  });

  it("advances only the end for a custom following range", () => {
    const value = {
      from: 1_700_000_000_000,
      to: 1_800_000_000_000,
      followNow: true,
    };
    expect(resolveDateTimeRange(value, value.to + 100_000)).toEqual({
      ...value,
      to: value.to + 100_000,
    });
  });

  it("uses local midnight for today including across a month boundary", () => {
    const now = new Date(2026, 9, 1, 23, 48).getTime();
    const value = quickDateTimeRange("today", true, now);
    expect(value.from).toBe(new Date(2026, 9, 1).getTime());
    expect(
      resolveDateTimeRange(value, new Date(2026, 10, 1, 0, 1).getTime()).from,
    ).toBe(new Date(2026, 10, 1).getTime());
  });

  it("rejects impossible calendar dates and malformed HH:mm input", () => {
    expect(parseRangeDateTime("2026/02/29", "12:00")).toBeNull();
    expect(parseRangeDateTime("2028/02/29", "12:00")).toBe(
      new Date(2028, 1, 29, 12).getTime(),
    );
    expect(parseRangeDateTime("2026/10/01", "24:00")).toBeNull();
    expect(parseRangeDateTime("2026/10/01", "23:60")).toBeNull();
    expect(parseRangeDateTime("2026/10/01", "9:00")).toBeNull();
    expect(parseRangeDateTime("2026/10/01", "09:")).toBeNull();
  });
});
