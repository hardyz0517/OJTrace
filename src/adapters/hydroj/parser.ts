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
  authenticated: boolean;
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

function parseStatus(cell: string): { status?: string; score?: number } {
  const scoreText = textOf(cell.match(/<span[^>]*>([^<]+)<\/span>/i)?.[1]);
  const score = /^\d+(?:\.\d+)?$/.test(scoreText)
    ? Number(scoreText)
    : undefined;
  const statusText = textOf(
    cell.match(/record-status--text[^>]*>([\s\S]*?)<\/a>/i)?.[1],
  )
    .replace(/^[-+]?\d+(?:\.\d+)?\s*/, "")
    .trim();
  return { status: statusText || undefined, score };
}

export function isHydroOJLoginPage(text: string): boolean {
  return (
    /<html[^>]+data-page=["']user_login["']/i.test(text) ||
    /<title>\s*(?:登录|Login)\s*<\/title>/i.test(text)
  );
}

export function parseHydroOJRecordPage(text: string): HydroOJRecordPage {
  if (/^\s*\{/.test(text)) return parseHydroOJJsonRecordPage(text);
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
      memory: Number(memoryText.match(/[\d.]+/)?.[0] ?? NaN),
      lang: lang || undefined,
      submitAt: timestamp,
      submissionUrl: `/record/${encodeURIComponent(rid)}`,
      problemUrl: problem?.[1],
    } satisfies HydroOJRawRecord;
  });
  return {
    page,
    rdocs,
    hasMore: /class=["'][^"']*pager__item[^"']*next[^"']*["'][^>]+href=/i.test(
      text,
    ),
    authenticated: true,
  };
}

export function parseHydroOJJsonRecordPage(text: string): HydroOJRecordPage {
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
  return {
    page: response.page,
    rdocs: response.rdocs as HydroOJRawRecord[],
    hasMore: false,
    authenticated: true,
  };
}

/** HTML fallback is deliberately not parsed until a real deployment is sampled. */
export function assertHydroOJJsonResponse(contentType: string): void {
  if (!/\bjson\b/i.test(contentType)) {
    throw new Error("HydroOJ response is not a supported JSON API response");
  }
}
