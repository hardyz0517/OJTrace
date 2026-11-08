import type { ContestRecord } from "../../core/types";
import { ContestProviderError } from "../types";

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, number: string) =>
      String.fromCodePoint(Number(number)),
    )
    .replace(/&#x([\da-f]+);/gi, (_match, number: string) =>
      String.fromCodePoint(Number.parseInt(number, 16)),
    );
}

function plainText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseAtcoderTime(value: string): number | undefined {
  const match = value
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):?(\d{2})$/,
    );
  if (!match) return undefined;
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    sign,
    offsetHour,
    offsetMinute,
  ] = match;
  const localUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const offsetMinutes =
    (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === "+" ? 1 : -1);
  const timestamp = localUtc - offsetMinutes * 60_000;
  return Number.isSafeInteger(timestamp) && timestamp > 0
    ? timestamp
    : undefined;
}

function parseDuration(value: string): number | undefined {
  const match = value.trim().match(/^(\d{1,4}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (minutes > 59 || seconds > 59) return undefined;
  const duration = hours * 3_600 + minutes * 60 + seconds;
  return Number.isSafeInteger(duration) && duration > 0 ? duration : undefined;
}

function extractSection(html: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `<div\\b[^>]*\\bid=['"]${escaped}['"][^>]*>`,
    "i",
  ).exec(html);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length;
  const nextSection = /<div\b[^>]*\bid=['"]contest-table-[^'"]+['"][^>]*>/gi;
  nextSection.lastIndex = start;
  const next = nextSection.exec(html);
  return html.slice(start, next?.index ?? html.length);
}

function parseRows(section: string, fetchedAt: number): ContestRecord[] {
  const rows = section.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  return rows.flatMap((row): ContestRecord[] => {
    const cells = row.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) ?? [];
    if (cells.length < 3) return [];
    const timeText = cells[0]?.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1];
    const time = timeText ? parseAtcoderTime(plainText(timeText)) : undefined;
    const link = cells[1]?.match(
      /<a\b[^>]*href=['"](\/contests\/([\w-]+)\/?)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const title = link ? plainText(link[3] ?? "") : "";
    if (!time || !link || !title) return [];
    const durationSeconds = parseDuration(plainText(cells[2] ?? ""));
    const ratedRange = cells[3] ? plainText(cells[3]) : "";
    return [
      {
        id: link[2]!,
        platform: "atcoder",
        title,
        url: `https://atcoder.jp${link[1]}`,
        startTime: time,
        ...(durationSeconds === undefined
          ? {}
          : { durationSeconds, endTime: time + durationSeconds * 1_000 }),
        ...(ratedRange && ratedRange !== "-" ? { ratedRange } : {}),
        fetchedAt,
      },
    ];
  });
}

export function parseAtcoderContestPage(
  html: string,
  fetchedAt = Date.now(),
): ContestRecord[] {
  if (
    !html.includes("contest-table-upcoming") ||
    !html.includes("contest-table-recent")
  )
    throw new ContestProviderError(
      "atcoder",
      "invalid-response",
      "AtCoder 比赛列表结构已变化。",
    );
  return [
    ...parseRows(extractSection(html, "contest-table-action"), fetchedAt),
    ...parseRows(extractSection(html, "contest-table-upcoming"), fetchedAt),
    ...parseRows(extractSection(html, "contest-table-daily"), fetchedAt),
    ...parseRows(extractSection(html, "contest-table-recent"), fetchedAt),
  ];
}
