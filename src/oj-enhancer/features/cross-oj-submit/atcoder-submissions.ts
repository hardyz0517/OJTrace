import {
  attr,
  findAll,
  findFirst,
  hasClass,
  parseHtmlDocument,
  textContent,
  type HtmlElementNode,
} from "../../../problem/extract/html-document";
import type {
  AtCoderProblemRef,
  CrossOjEvaluationStatus,
  CrossOjRecordListItem,
} from "./model";

export const ATCODER_SUBMISSIONS_MAX_PAGES = 20;
const MAX_RESPONSE_CHARS = 5_000_000;

export interface AtCoderSubmissionPage {
  records: CrossOjRecordListItem[];
  hasNextPage: boolean;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeSegment(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && !/[/?#]/.test(value);
}

export function atCoderSubmissionsPageUrl(
  handle: string,
  problem: AtCoderProblemRef,
  page = 1,
): string {
  const params = new URLSearchParams({
    "f.Task": problem.taskId,
    "f.LanguageName": "",
    "f.Status": "",
    "f.User": handle,
  });
  if (page > 1) params.set("page", String(page));
  return `https://atcoder.jp/contests/${encodeURIComponent(problem.contestId)}/submissions?${params.toString()}`;
}

function normalizeAtCoderOffset(value: string): string {
  if (value === "Z" || value === "z") return "Z";
  if (value.includes(":")) return value;
  return `${value.slice(0, 3)}:${value.slice(3)}`;
}

function parseTimestamp(value: string): number | undefined {
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/.exec(
      normalized(value),
    );
  if (!match) return undefined;
  // Official pages keep the JST offset in the raw HTML, e.g.
  // "2026-11-05 18:52:12+0900". Default to +09:00 when it is omitted.
  const offset = match[3] ? normalizeAtCoderOffset(match[3]) : "+09:00";
  const timestamp = Date.parse(`${match[1]}T${match[2]}${offset}`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function parseUnixMillis(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000_000)
    return Math.trunc(numeric);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000)
    return Math.trunc(numeric * 1000);
  if (/^\d{4}-\d{2}-\d{2}T/.test(value.trim())) {
    const timestamp = Date.parse(value.trim());
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return parseTimestamp(value);
}

function timestampFromCell(cell: HtmlElementNode | undefined): number | undefined {
  if (!cell) return undefined;
  const timeNode = findFirst(cell, (node) => node.tagName === "time");
  return (
    parseUnixMillis(timeNode ? attr(timeNode, "data-time") : undefined) ??
    parseUnixMillis(timeNode ? attr(timeNode, "data-unix") : undefined) ??
    parseUnixMillis(timeNode ? attr(timeNode, "datetime") : undefined) ??
    parseTimestamp(cellText(cell))
  );
}

function parseNumber(value: string): number | undefined {
  const match = /-?\d+(?:\.\d+)?/.exec(value.replace(/,/g, ""));
  if (!match) return undefined;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : undefined;
}

function parseMemoryBytes(value: string): number | undefined {
  const amount = parseNumber(value);
  if (amount === undefined) return undefined;
  const unit = value.match(/\b(kib|kb|mib|mb|bytes?|b)\b/i)?.[1]?.toLowerCase();
  const multiplier = unit === "mib" || unit === "mb"
    ? 1024 * 1024
    : unit === "kib" || unit === "kb"
      ? 1024
      : 1;
  const bytes = amount * multiplier;
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

function statusFromText(value: string): {
  status: CrossOjEvaluationStatus;
  raw: string;
} {
  const raw = normalized(value);
  if (/^(?:AC|Accepted)$/i.test(raw))
    return { status: "accepted", raw };
  if (/^(?:WJ|Waiting for Judging|Judging)$/i.test(raw))
    return { status: "judging", raw };
  return { status: raw ? "rejected" : "unknown", raw };
}

function childCells(row: HtmlElementNode): HtmlElementNode[] {
  return row.children.filter(
    (child): child is HtmlElementNode =>
      child.type === "element" && (child.tagName === "td" || child.tagName === "th"),
  );
}

function directRows(table: HtmlElementNode): HtmlElementNode[] {
  return findAll(table, (node) => node.tagName === "tr").filter((row) => {
    const parent = row.parent;
    return (
      parent === table ||
      parent?.tagName === "thead" ||
      parent?.tagName === "tbody"
    );
  });
}

function cellText(cell: HtmlElementNode | undefined): string {
  return cell ? normalized(textContent(cell)) : "";
}

function tableLooksLikeSubmissions(table: HtmlElementNode): boolean {
  const header = directRows(table).find((row) =>
    childCells(row).some((cell) => /submission\s*time/i.test(cellText(cell))) &&
    childCells(row).some((cell) => /^status$/i.test(cellText(cell))),
  );
  if (!header) return false;
  const names = childCells(header).map(cellText);
  return (
    names.some((name) => /^task$/i.test(name)) &&
    names.some((name) => /^user$/i.test(name)) &&
    names.some((name) => /^language$/i.test(name)) &&
    names.some((name) => /^score$/i.test(name)) &&
    names.some((name) => /code\s*size/i.test(name)) &&
    names.some((name) => /exec\s*time/i.test(name)) &&
    names.some((name) => /^memory$/i.test(name))
  );
}

function detailLink(
  row: HtmlElementNode,
  contestId: string,
): { submissionId: string; detailUrl: string } | undefined {
  const link = findFirst(row, (node) => {
    if (node.tagName !== "a") return false;
    const href = attr(node, "href") ?? "";
    return new RegExp(
      `^/contests/${escapeRegExp(contestId)}/submissions/(\\d{1,20})/?$`,
      "i",
    ).test(href);
  });
  const href = link ? attr(link, "href") : undefined;
  const match = href
    ? new RegExp(
        `^/contests/${escapeRegExp(contestId)}/submissions/(\\d{1,20})/?$`,
        "i",
      ).exec(href)
    : undefined;
  if (!match) return undefined;
  return {
    submissionId: match[1]!,
    detailUrl: `https://atcoder.jp/contests/${encodeURIComponent(contestId)}/submissions/${match[1]}`,
  };
}

function taskIdFromRow(
  row: HtmlElementNode,
  contestId: string,
): string | undefined {
  const link = findFirst(row, (node) => {
    if (node.tagName !== "a") return false;
    const href = attr(node, "href") ?? "";
    return new RegExp(
      `^/contests/${escapeRegExp(contestId)}/tasks/([^/?#]{1,120})/?$`,
      "i",
    ).test(href);
  });
  const href = link ? attr(link, "href") : undefined;
  const match = href
    ? new RegExp(
        `^/contests/${escapeRegExp(contestId)}/tasks/([^/?#]{1,120})/?$`,
        "i",
      ).exec(href)
    : undefined;
  return match?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pageNumberFromHref(href: string): number | undefined {
  try {
    const page = Number(new URL(href, "https://atcoder.jp").searchParams.get("page"));
    return Number.isSafeInteger(page) && page > 0 ? page : undefined;
  } catch {
    return undefined;
  }
}

function nextPageAvailable(
  html: string,
  root: ReturnType<typeof parseHtmlDocument>,
): boolean {
  const labelled = findAll(root, (node) => {
    if (node.tagName !== "a") return false;
    const text = normalized(textContent(node));
    if (!/^(?:next\s*>|>)$/i.test(text)) return false;
    const parent = node.parent;
    return !(parent && hasClass(parent, "disabled"));
  }).length > 0;
  if (labelled) return true;
  let current = 1;
  const laterPages: number[] = [];
  for (const link of findAll(root, (node) => node.tagName === "a")) {
    const page = pageNumberFromHref(attr(link, "href") ?? "");
    if (page === undefined) continue;
    laterPages.push(page);
    if (link.parent && hasClass(link.parent, "active")) current = page;
  }
  if (laterPages.some((page) => page > current)) return true;
  const rawActive = /class=["'][^"']*\bactive\b[^"']*["'][^>]*>[\s\S]{0,240}?page=(\d+)/i.exec(
    html,
  );
  if (rawActive?.[1]) current = Number(rawActive[1]) || current;
  return [...html.matchAll(/[?&]page=(\d+)/gi)].some((match) => {
    const page = Number(match[1]);
    return Number.isInteger(page) && page > current;
  });
}

function fallbackRecordsFromHtml(
  html: string,
  problem: AtCoderProblemRef,
  handle: string,
  observedAt: number,
): CrossOjRecordListItem[] {
  const contest = escapeRegExp(problem.contestId);
  const task = escapeRegExp(problem.taskId);
  const pattern = new RegExp(
    `<tr\\b[\\s\\S]{0,4000}?href=["']/contests/${contest}/tasks/${task}(?:/)?["'][\\s\\S]{0,4000}?href=["']/contests/${contest}/submissions/(\\d{1,20})(?:/)?["'][\\s\\S]{0,800}?</tr>`,
    "gi",
  );
  const records: CrossOjRecordListItem[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(pattern)) {
    const submissionId = match[1];
    const row = match[0];
    if (!submissionId || seen.has(submissionId)) continue;
    seen.add(submissionId);
    const timeText = /<time\b[^>]*>([\s\S]*?)<\/time>/i.exec(row)?.[1] ?? "";
    const timestamp = parseTimestamp(timeText) ?? observedAt;
    const statusText =
      />\s*(AC|WA|TLE|MLE|RE|CE|WJ|IE)\s*<\/span>/i.exec(row)?.[1] ?? "";
    const status = statusFromText(statusText);
    const score = parseNumber(
      /submission-score[^>]*>\s*([^<]+)/i.exec(row)?.[1] ?? "",
    );
    records.push({
      oj: "atcoder",
      submissionId,
      problemId: problem.taskId,
      detailUrl: `https://atcoder.jp/contests/${encodeURIComponent(problem.contestId)}/submissions/${submissionId}`,
      observedAt: timestamp,
      statusUpdatedAt: observedAt,
      evaluationStatus: status.status,
      ...(status.raw ? { rawVerdict: status.raw } : {}),
      accountName: handle,
      ...(score !== undefined ? { score } : {}),
    });
  }
  return records;
}

export function parseAtCoderSubmissionsPage(
  html: string,
  handle: string,
  problem: AtCoderProblemRef,
  observedAt = Date.now(),
): AtCoderSubmissionPage {
  if (html.length > MAX_RESPONSE_CHARS)
    throw new Error("AtCoder 提交记录响应过大。");
  if (!safeSegment(handle, 64) || !safeSegment(problem.contestId, 64))
    throw new Error("AtCoder 查询参数无效。");
  const root = parseHtmlDocument(html);
  const table = findFirst(root, tableLooksLikeSubmissions);
  const fallback = fallbackRecordsFromHtml(html, problem, handle, observedAt);
  if (!table) {
    if (fallback.length)
      return { records: fallback, hasNextPage: nextPageAvailable(html, root) };
    throw new Error("AtCoder 提交记录页面结构已变化。");
  }
  const rows = directRows(table);
  const header = rows.find((row) =>
    childCells(row).some((cell) => /submission\s*time/i.test(cellText(cell))),
  );
  if (!header) throw new Error("AtCoder 提交记录表头缺失。");
  const headers = childCells(header).map(cellText);
  const indexOf = (pattern: RegExp): number =>
    headers.findIndex((value) => pattern.test(value));
  const timeIndex = indexOf(/submission\s*time/i);
  const taskIndex = indexOf(/^task$/i);
  const languageIndex = indexOf(/^language$/i);
  const scoreIndex = indexOf(/^score$/i);
  const sizeIndex = indexOf(/code\s*size/i);
  const statusIndex = indexOf(/^status$/i);
  const execIndex = indexOf(/exec\s*time/i);
  const memoryIndex = indexOf(/^memory$/i);
  const records: CrossOjRecordListItem[] = [];
  for (const row of rows) {
    if (row === header) continue;
    const cells = childCells(row);
    const detail = detailLink(row, problem.contestId);
    const taskId = taskIdFromRow(row, problem.contestId);
    const timestamp = timestampFromCell(cells[timeIndex]) ?? observedAt;
    if (
      !detail ||
      !taskId ||
      taskId.toLowerCase() !== problem.taskId.toLowerCase()
    )
      continue;
    const status = statusFromText(cellText(cells[statusIndex]));
    const score = parseNumber(cellText(cells[scoreIndex]));
    const codeLength = parseNumber(cellText(cells[sizeIndex]));
    const timeMs = parseNumber(cellText(cells[execIndex]));
    const memoryBytes = parseMemoryBytes(cellText(cells[memoryIndex]));
    const taskName = cellText(cells[taskIndex]);
    records.push({
      oj: "atcoder",
      submissionId: detail.submissionId,
      problemId: problem.taskId,
      detailUrl: detail.detailUrl,
      observedAt: timestamp,
      statusUpdatedAt: observedAt,
      evaluationStatus: status.status,
      ...(status.raw ? { rawVerdict: status.raw } : {}),
      accountName: handle,
      ...(taskName ? { problemName: taskName } : {}),
      ...(cellText(cells[languageIndex])
        ? { language: cellText(cells[languageIndex]) }
        : {}),
      ...(score !== undefined ? { score } : {}),
      ...(codeLength !== undefined ? { codeLength } : {}),
      ...(timeMs !== undefined ? { timeMs } : {}),
      ...(memoryBytes !== undefined ? { memoryBytes } : {}),
    });
  }
  if (!records.length && fallback.length) return { records: fallback, hasNextPage: nextPageAvailable(html, root) };
  return { records, hasNextPage: nextPageAvailable(html, root) };
}
