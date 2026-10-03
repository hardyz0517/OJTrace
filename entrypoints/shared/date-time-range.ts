export type DateTimeRangePreset = "today" | 1 | 7 | 14 | 30 | 365 | 36500;

export interface DateTimeRange {
  from: number;
  to: number;
  followNow: boolean;
  /** A shortcut follows a rolling window until either endpoint is edited. */
  preset?: DateTimeRangePreset;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export function quickDateTimeRange(
  preset: DateTimeRangePreset,
  followNow = true,
  now = Date.now(),
): DateTimeRange {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return {
    from:
      preset === "today"
        ? today.getTime()
        : preset === 36500
          ? 0
          : now - preset * DAY_MS,
    to: now,
    followNow,
    preset,
  };
}

export function resolveDateTimeRange(
  value: DateTimeRange,
  now = Date.now(),
): DateTimeRange {
  if (!value.followNow) return value;
  return value.preset === undefined
    ? { ...value, to: now }
    : quickDateTimeRange(value.preset, true, now);
}

export function formatRangeDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getFullYear()).padStart(4, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

export function formatRangeTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function parseRangeDateTime(date: string, time: string): number | null {
  const dateMatch = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (year < 1 || hour > 23 || minute > 59) return null;
  const parsed = new Date(0);
  parsed.setFullYear(year, month, day);
  parsed.setHours(hour, minute, 0, 0);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month &&
    parsed.getDate() === day &&
    parsed.getHours() === hour &&
    parsed.getMinutes() === minute
    ? parsed.getTime()
    : null;
}

export function dateWithTime(day: Date, timestamp: number): number {
  const time = new Date(timestamp);
  const result = new Date(day);
  result.setHours(
    time.getHours(),
    time.getMinutes(),
    time.getSeconds(),
    time.getMilliseconds(),
  );
  return result.getTime();
}
