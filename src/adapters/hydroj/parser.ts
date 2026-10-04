import {
  hydroDomainFromUrl,
  hydroDomainPrefix,
  hydroScopedUrl,
  isHydroScopeUrl,
} from "../../domain/hydro-scope";
import type { ActivityScheduleRecord } from "../../domain/activity-schedule";

export interface HydroOJRawRecord {
  _id?: string;
  rid?: string;
  pid?: string | number;
  problemName?: string;
  uid?: number;
  lang?: string;
  status?: number | string;
  statusText?: string;
  score?: number;
  time?: number;
  memory?: number;
  judgeAt?: string | number | Date;
  submitAt?: string | number | Date;
  submissionUrl?: string;
  problemUrl?: string;
  [key: string]: unknown;
}

export interface HydroOJRecordPage {
  page: number;
  rdocs: HydroOJRawRecord[];
  hasMore: boolean;
  /** Whether hasMore was explicitly supplied by the verified response contract. */
  paginationKnown?: boolean;
  authenticated: boolean;
  activitySchedule?: Pick<
    ActivityScheduleRecord,
    "activityId" | "beginAt" | "endAt"
  >;
}

function activityTimestamp(value: unknown): number | undefined {
  // Hydro serializes Date fields as ISO strings, not Unix seconds.
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return;
  const timestamp = Date.parse(value);
  return Number.isSafeInteger(timestamp) && timestamp >= 0
    ? timestamp
    : undefined;
}

function parseActivitySchedule(
  value: unknown,
  responseUrl?: string,
): HydroOJRecordPage["activitySchedule"] {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !responseUrl
  )
    return;
  const tdoc = value as Record<string, unknown>;
  const url = new URL(responseUrl);
  const requestedId = url.searchParams.get("tid");
  if (
    typeof tdoc.docId !== "string" ||
    !isObjectId(tdoc.docId) ||
    tdoc.docId.toLowerCase() !== requestedId?.toLowerCase() ||
    (hydroDomainFromUrl(responseUrl) !== undefined &&
      tdoc.domainId !== undefined &&
      tdoc.domainId !== hydroDomainFromUrl(responseUrl)) ||
    typeof tdoc.rule !== "string" ||
    ![
      "homework",
      "oi",
      "ioi",
      "acm",
      "noi",
      "codeforces",
      "strictioi",
      "ledo",
    ].includes(tdoc.rule)
  )
    return;
  const beginAt = activityTimestamp(tdoc.beginAt);
  const endAt = activityTimestamp(tdoc.endAt);
  if (beginAt === undefined || endAt === undefined || beginAt >= endAt) return;
  return { activityId: tdoc.docId.toLowerCase(), beginAt, endAt };
}

export interface HydroActivity {
  id: string;
  title: string;
  type: "contest" | "homework" | "other";
  url?: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
}

function textOf(value: string | undefined): string {
  return decodeHtml(
    (value ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function activityTitle(value: string | undefined): string {
  const withoutBadges = (value ?? "").replace(
    /<[^>]*class=["'][^"']*(?:badge|label|contest-type|activity-type)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi,
    " ",
  );
  return textOf(withoutBadges);
}

function isObjectId(value: string): boolean {
  return /^[0-9a-f]{24}$/i.test(value);
}

function memoryInKiB(text: string): number | undefined {
  const match = text.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|KB|MB|GB)$/i);
  if (!match) return undefined;
  const units: Record<string, number> = {
    b: 1 / 1024,
    kib: 1,
    kb: 1,
    mib: 1024,
    mb: 1024,
    gib: 1024 * 1024,
    gb: 1024 * 1024,
  };
  const value = Number(match[1]) * units[match[2]!.toLowerCase()]!;
  return Number.isFinite(value) ? value : undefined;
}

export function parseHydroUserActivities(
  text: string,
  responseUrl: string,
): HydroActivity[] {
  const origin = new URL(responseUrl).origin;
  const domainId = hydroDomainFromUrl(responseUrl);
  const result = new Map<string, HydroActivity>();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(linkPattern)) {
    const href = match[1];
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, responseUrl);
    } catch {
      continue;
    }
    if (!isHydroScopeUrl({ origin, domainId }, url.href)) continue;
    const parts = url.pathname
      .slice(hydroDomainPrefix(domainId).length)
      .split("/")
      .filter(Boolean);
    if (parts.length !== 2 || !["contest", "homework"].includes(parts[0]!))
      continue;
    const id = parts[1]!;
    if (!isObjectId(id) || result.has(id)) continue;
    const title = activityTitle(match[2]);
    if (!title) continue;
    result.set(id, {
      id,
      title,
      type: parts[0] === "homework" ? "homework" : "contest",
      url: hydroScopedUrl({ origin, domainId }, `/${parts[0]}/${id}`),
    });
  }
  return [...result.values()];
}

export function parseHydroUserActivitiesJson(
  value: unknown,
  responseUrl: string,
): { activities: HydroActivity[]; invalidCount: number } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unsupported user page");
  const tdocs = (value as { tdocs?: unknown }).tdocs;
  if (!Array.isArray(tdocs)) throw new Error("Unsupported user page");
  const origin = new URL(responseUrl).origin;
  const domainId = hydroDomainFromUrl(responseUrl);
  const activities = new Map<string, HydroActivity>();
  let invalidCount = 0;
  for (const raw of tdocs) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      invalidCount += 1;
      continue;
    }
    const item = raw as Record<string, unknown>;
    const id = typeof item.docId === "string" ? item.docId : "";
    const title =
      typeof item.title === "string" ? activityTitle(item.title) : "";
    const rule = typeof item.rule === "string" ? item.rule : "";
    if (!isObjectId(id) || !title) {
      invalidCount += 1;
      continue;
    }
    if (activities.has(id)) continue;
    const normalizedRule = rule.toLowerCase();
    const type =
      normalizedRule === "homework"
        ? "homework"
        : ["oi", "ioi", "acm", "noi", "codeforces"].includes(normalizedRule)
          ? "contest"
          : "other";
    activities.set(id, {
      id,
      title,
      type,
      ...(type === "other"
        ? {}
        : { url: hydroScopedUrl({ origin, domainId }, `/${type}/${id}`) }),
    });
  }
  return { activities: [...activities.values()], invalidCount };
}

function parseStatus(cell: string): { status?: string; score?: number } {
  const statusText = textOf(
    cell.match(/record-status--text[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? cell,
  );
  const scoreText = textOf(cell.match(/<span[^>]*>([^<]+)<\/span>/i)?.[1]);
  const scoreToken =
    scoreText || statusText.match(/^[-+]?\d+(?:\.\d+)?/)?.[0] || "";
  const score = /^[-+]?\d+(?:\.\d+)?$/.test(scoreToken)
    ? Number(scoreToken)
    : undefined;
  const normalizedStatus = statusText
    .replace(/^[-+]?\d+(?:\.\d+)?\s*/, "")
    .trim();
  return { status: normalizedStatus || undefined, score };
}

export function isHydroOJLoginPage(text: string): boolean {
  return (
    /<html[^>]+data-page=["']user_login["']/i.test(text) ||
    /<title>\s*(?:登录|Login)\s*<\/title>/i.test(text)
  );
}

export function parseHydroOJRecordPage(
  text: string,
  responseUrl?: string,
): HydroOJRecordPage {
  if (/^\s*\{/.test(text)) return parseHydroOJJsonRecordPage(text, responseUrl);
  if (isHydroOJLoginPage(text))
    return { page: 1, rdocs: [], hasMore: false, authenticated: false };
  if (!/data-page=["']record_main["']/i.test(text))
    throw new Error("HydroOJ response is not a supported record page");
  const page = Number(text.match(/(?:[?&]|&amp;)page=(\d+)/i)?.[1] ?? 1);
  const rows = [
    ...text.matchAll(/<tr\s+data-rid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/tr>/gi),
  ];
  const rdocs = rows.map((match) => {
    const rid = decodeHtml(match[1]!);
    const row = match[2]!;
    const problem = row.match(
      /<td[^>]*col--problem[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<b>([^<]+)<\/b>([\s\S]*?)<\/a>/i,
    );
    const statusCell =
      row.match(/<td[^>]*col--status[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";
    const status = parseStatus(statusCell);
    const timestamp = row.match(/data-timestamp=["']([^"']+)["']/i)?.[1];
    const timeText = textOf(
      row.match(/<td[^>]*col--time[^>]*>([\s\S]*?)<\/td>/i)?.[1],
    );
    const memoryText = textOf(
      row.match(/<td[^>]*col--memory[^>]*>([\s\S]*?)<\/td>/i)?.[1],
    );
    const lang = textOf(
      row.match(/<td[^>]*col--lang[^>]*>([\s\S]*?)<\/td>/i)?.[1],
    );
    return {
      rid,
      pid: problem?.[2] ? textOf(problem[2]) : undefined,
      problemName: problem?.[3] ? textOf(problem[3]) : undefined,
      status: status.status,
      statusText: status.status,
      score: status.score,
      time: Number(timeText.match(/[\d.]+/)?.[0] ?? NaN),
      memory: memoryInKiB(memoryText),
      lang: lang || undefined,
      submitAt: timestamp,
      submissionUrl: `${hydroDomainPrefix(responseUrl ? hydroDomainFromUrl(responseUrl) : undefined)}/record/${encodeURIComponent(rid)}`,
      problemUrl: problem?.[1] ? decodeHtml(problem[1]) : undefined,
    } satisfies HydroOJRawRecord;
  });
  return {
    page,
    rdocs,
    hasMore: /class=["'][^"']*pager__item[^"']*next[^"']*["'][^>]+href=/i.test(
      text,
    ),
    paginationKnown: true,
    authenticated: true,
  };
}

export function parseHydroOJJsonRecordPage(
  text: string,
  responseUrl?: string,
): HydroOJRecordPage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("HydroOJ response is not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("HydroOJ response is not an object");
  }
  const response = value as Record<string, unknown>;
  const prefix = hydroDomainPrefix(
    responseUrl ? hydroDomainFromUrl(responseUrl) : undefined,
  );
  if (!Array.isArray(response.rdocs) || typeof response.page !== "number") {
    throw new Error(
      "HydroOJ response does not match the verified record-page contract",
    );
  }
  if (!Number.isSafeInteger(response.page) || response.page < 1) {
    throw new Error("HydroOJ response has an invalid page");
  }
  if (
    response.rdocs.some(
      (record) =>
        !record || typeof record !== "object" || Array.isArray(record),
    )
  ) {
    throw new Error("HydroOJ response contains an invalid record");
  }
  const paginationKnown =
    Object.prototype.hasOwnProperty.call(response, "hasMore") &&
    typeof response.hasMore === "boolean";
  return {
    page: response.page,
    activitySchedule: parseActivitySchedule(response.tdoc, responseUrl),
    rdocs: (response.rdocs as HydroOJRawRecord[]).map((raw) => {
      const pdict = response.pdict as
        Record<string, Record<string, unknown>> | undefined;
      const problem = pdict?.[String(raw.pid)];
      const responseTid = responseUrl
        ? new URL(responseUrl).searchParams.get("tid")
        : undefined;
      const tid =
        typeof raw.contest === "string" && isObjectId(raw.contest)
          ? raw.contest
          : responseTid && isObjectId(responseTid)
            ? responseTid
            : typeof (response.tdoc as { docId?: unknown } | undefined)
                  ?.docId === "string"
              ? (response.tdoc as { docId: string }).docId
              : undefined;
      const displayPid = problem?.pid ?? problem?.docId ?? raw.pid;
      const routePid = problem?.docId ?? raw.pid;
      const problemPath =
        routePid === undefined
          ? undefined
          : `${prefix}/p/${encodeURIComponent(String(routePid))}${tid && isObjectId(tid) ? `?tid=${encodeURIComponent(tid)}` : ""}`;
      return {
        ...raw,
        pid:
          typeof displayPid === "string" || typeof displayPid === "number"
            ? displayPid
            : raw.pid,
        problemName:
          typeof problem?.title === "string"
            ? textOf(problem.title)
            : raw.problemName,
        problemUrl: problemPath ?? raw.problemUrl,
        submissionUrl: `${prefix}/record/${encodeURIComponent(String(raw._id ?? raw.rid))}`,
      };
    }),
    hasMore: paginationKnown ? response.hasMore === true : false,
    paginationKnown,
    authenticated: true,
  };
}
