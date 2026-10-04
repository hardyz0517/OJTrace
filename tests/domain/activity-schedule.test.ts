import { describe, expect, it } from "vitest";
import {
  ACTIVITY_SCHEDULE_TTL_MS,
  activityScheduleKey,
  isActivityOutsideWindow,
  sanitizeActivitySchedule,
  updateActivityScheduleCache,
  type ActivityScheduleRecord,
} from "../../src/domain/activity-schedule";

const schedule: ActivityScheduleRecord = {
  source: "hydroj",
  origin: "https://school.example.org",
  activityId: "0".repeat(24),
  beginAt: 10,
  endAt: 20,
  checkedAt: 100,
};
const window = { since: 30, until: 100 };

describe("activity schedule cache", () => {
  it("only excludes ended activities with fresh valid evidence, using the actual window", () => {
    expect(isActivityOutsideWindow(schedule, window, 100)).toBe(true);
    expect(
      isActivityOutsideWindow(schedule, { since: 20, until: 100 }, 100),
    ).toBe(false);
    expect(
      isActivityOutsideWindow(schedule, { since: 15, until: 100 }, 100),
    ).toBe(false);
    expect(isActivityOutsideWindow(schedule, window, 99)).toBe(false);
    expect(
      isActivityOutsideWindow(schedule, window, 100 + ACTIVITY_SCHEDULE_TTL_MS),
    ).toBe(false);
    expect(
      isActivityOutsideWindow({ ...schedule, endAt: undefined }, window, 100),
    ).toBe(false);
  });
  it("isolates instances and default/explicit domains and normalizes ObjectIds", () => {
    expect(activityScheduleKey(schedule)).not.toBe(
      activityScheduleKey({ ...schedule, domainId: "student" }),
    );
    expect(activityScheduleKey(schedule)).not.toBe(
      activityScheduleKey({ ...schedule, origin: "https://other.example.org" }),
    );
    expect(
      activityScheduleKey({ ...schedule, activityId: "A".repeat(24) }),
    ).toBe(activityScheduleKey({ ...schedule, activityId: "a".repeat(24) }));
  });
  it("rejects corrupt identities and clears invalid timing instead of guessing", () => {
    expect(
      sanitizeActivitySchedule({
        ...schedule,
        origin: schedule.origin + "/d/student/",
      }),
    ).toBeUndefined();
    expect(
      sanitizeActivitySchedule({ ...schedule, domainId: "../bad" }),
    ).toBeUndefined();
    expect(
      sanitizeActivitySchedule({ ...schedule, checkedAt: NaN }),
    ).toBeUndefined();
    expect(sanitizeActivitySchedule({ ...schedule, beginAt: 30 })).toEqual({
      source: schedule.source,
      origin: schedule.origin,
      activityId: schedule.activityId,
      checkedAt: 100,
    });
  });
  it("replaces old timing with unknown evidence and rejects older writes", () => {
    const initial = updateActivityScheduleCache({}, [schedule]);
    const key = activityScheduleKey(schedule);
    const cleared = updateActivityScheduleCache(initial, [
      { ...schedule, beginAt: undefined, endAt: undefined, checkedAt: 200 },
    ]);
    expect(cleared[key]?.endAt).toBeUndefined();
    expect(updateActivityScheduleCache(cleared, [schedule])[key]).toEqual(
      cleared[key],
    );
    expect(
      updateActivityScheduleCache(cleared, [
        { ...schedule, endAt: 150, checkedAt: 300 },
      ])[key]?.endAt,
    ).toBe(150);
  });
  it("bounds retained observations to the 512 most recent", () => {
    const cache = updateActivityScheduleCache(
      {},
      Array.from({ length: 520 }, (_, n) => ({
        ...schedule,
        activityId: n.toString(16).padStart(24, "0"),
        checkedAt: n,
      })),
    );
    expect(Object.keys(cache)).toHaveLength(512);
    expect(Object.values(cache).every((item) => item.checkedAt >= 8)).toBe(
      true,
    );
  });
});
