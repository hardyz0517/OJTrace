import { QOJ_ORIGIN } from "./urls";
import { decodeHtml } from "../shared/html";
export interface QOJRawRecord {
  id: string;
  problemId: string;
  problemName?: string;
  problemUrl?: string;
  contestId?: string;
  result?: string;
  score?: number;
  timeMs?: number;
  memoryKb?: number;
  language?: string;
  codeLength?: number;
  submittedAt?: string;
}

export interface QOJRecordPage {
  page: number;
  records: QOJRawRecord[];
  hasMore: boolean;
  username?: string;
}

function textOf(value: string | undefined): string {
  return decodeHtml(
    (value ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ? decodeHtml(match[2]) : undefined;
}

function ulBlocks(text: string): string[] {
  const blocks: string[] = [];
  const tags = /<\/?ul\b[^>]*>/gi;
  let depth = 0;
  let start = -1;
  for (const match of text.matchAll(tags)) {
    const tag = match[0] ?? "";
    const offset = match.index ?? 0;
    if (/^<ul\b/i.test(tag)) {
      if (depth === 0) start = offset;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push(text.slice(start, offset + tag.length));
        start = -1;
      }
    }
  }
  return blocks;
}

function profileIdentity(value: string): string | undefined {
  const match = value.match(
    /<a\b(?=[^>]*class=["'][^"']*\buoj-username\b[^"']*["'])(?=[^>]*href=["'](?:(?:https?:)?\/\/qoj\.ac)?\/user\/profile\/([^"'/?#]+)["'])[^>]*>([\s\S]*?)<\/a>/i,
  );
  if (!match?.[1] || !match[2]) return undefined;
  let username: string;
  try {
    username = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
  const label = textOf(match[2]);
  const labelMatches =
    label === username ||
    (label.startsWith(username) &&
      !/[\p{L}\p{N}_]/u.test(label.slice(username.length)));
  return username && label && labelMatches && !/^guest$/i.test(username)
    ? username
    : undefined;
}

function profileLinkIdentity(value: string): string | undefined {
  const match = value.match(
    /<a\b(?=[^>]*href=["'](?:(?:https?:)?\/\/qoj\.ac)?\/user\/profile\/([^"'/?#]+)["'])[^>]*>([\s\S]*?)<\/a>/i,
  );
  if (!match?.[1] || !match[2]) return undefined;
  let username: string;
  try {
    username = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
  const label = textOf(match[2]);
  return username && label && username === label && !/^guest$/i.test(username)
    ? username
    : undefined;
}

function usernameSpanIdentity(value: string): string | undefined {
  const span = value.match(
    /<span\b(?=[^>]*class\s*=["'][^"']*\buoj-username\b[^"']*["'])[^>]*>([\s\S]*?)<\/span>/i,
  )?.[1];
  if (span) {
    const username = textOf(span);
    if (username && !/^guest$/i.test(username)) return username;
  }
  return undefined;
}

function dropdownIdentity(value: string): string | undefined {
  // Background fetches see the server's span, before uoj_highlight() turns it
  // into a profile link. data-link controls rendering, not authentication.
  return usernameSpanIdentity(value) ?? profileIdentity(value);
}

function cell(row: string, className: string): string {
  return (
    row.match(
      new RegExp(
        `<td\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
        "i",
      ),
    )?.[1] ?? ""
  );
}

function cells(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
    (match) => match[1] ?? "",
  );
}

function hrefAndText(
  value: string,
): { href: string; text: string } | undefined {
  const match = value.match(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
  );
  if (!match) return undefined;
  return { href: decodeHtml(match[1]!), text: textOf(match[2]) };
}

function problemFromCell(
  value: string,
):
  | Pick<QOJRawRecord, "problemId" | "problemName" | "problemUrl" | "contestId">
  | undefined {
  const link = hrefAndText(value);
  if (!link) return undefined;
  const path = link.href.match(
    /^(?:https?:\/\/[^/]+)?\/problem\/([1-9][0-9]{0,9})(?:\/|$)/i,
  );
  const contestPath = link.href.match(
    /^(?:https?:\/\/[^/]+)?\/contest\/([1-9][0-9]{0,9})\/problem\/([1-9][0-9]{0,9})(?:\/|$)/i,
  );
  if (!path && !contestPath) return undefined;
  const problemUrl = new URL(link.href, QOJ_ORIGIN);
  if (problemUrl.origin !== QOJ_ORIGIN) return undefined;
  const problemId = contestPath?.[2] ?? path?.[1];
  if (!problemId) return undefined;
  const prefix = `#${problemId}.`;
  const problemName = link.text.startsWith(prefix)
    ? link.text.slice(prefix.length).trim()
    : link.text.replace(new RegExp(`^${problemId}\\s*`), "").trim();
  return {
    problemId,
    problemName: problemName || undefined,
    problemUrl: problemUrl.href,
    ...(contestPath?.[1] ? { contestId: contestPath[1] } : {}),
  };
}

function sizeBytes(value: string): number | undefined {
  const match = textOf(value).match(/([\d.]+)\s*(b|kb|mb)\b/i);
  if (!match) return undefined;
  const number = Number(match[1]);
  const factor =
    match[2]!.toLowerCase() === "mb"
      ? 1024 * 1024
      : match[2]!.toLowerCase() === "kb"
        ? 1024
        : 1;
  return Number.isFinite(number) ? Math.round(number * factor) : undefined;
}

function rowRecord(row: string): QOJRawRecord | undefined {
  const idMatch = row.match(
    /<a\b[^>]*href=["'](?:https?:\/\/[^/]+)?\/submission\/([1-9][0-9]{0,9})["'][^>]*>/i,
  );
  const columns = cells(row);
  const problem = problemFromCell(
    cell(row, "col--problem") || columns[1] || "",
  );
  if (!idMatch || !problem) return undefined;
  // The UOJ renderer used by the community release emits plain <td>s (the
  // newer QOJ renderer may add column classes), so keep the positional
  // fallback in sync with /submissions: ID, problem, submitter, result,
  // time, memory, language, file size, submit time, judge time.
  const at = (className: string, index: number): string =>
    cell(row, className) || columns[index] || "";
  const resultCell = at("col--result", 3);
  const statusCell = at("col--status", 3);
  const result = textOf(resultCell || statusCell);
  const dataScore = attr(resultCell || statusCell, "data-score");
  const scoreValue =
    dataScore && /^-?\d+(?:\.\d+)?$/.test(dataScore)
      ? Number(dataScore)
      : undefined;
  const scoreMatch = result.match(/(?:^|\s)(-?\d+(?:\.\d+)?)(?:\s|$)/);
  const timeCell = textOf(at("col--used-time", 4) || at("col--time", 4));
  const memoryCell = textOf(at("col--used-memory", 5) || at("col--memory", 5));
  const memoryMatch = memoryCell.match(/([\d.]+)\s*(kb|kib|mb|mib)/i);
  const memoryKb = memoryMatch
    ? Math.round(
        Number(memoryMatch[1]) * (/mb|mib/i.test(memoryMatch[2]!) ? 1024 : 1),
      )
    : undefined;
  const timeMs = timeCell.match(/([\d.]+)\s*ms/i)?.[1]
    ? Number(timeCell.match(/([\d.]+)\s*ms/i)![1])
    : undefined;
  const lang = textOf(at("col--lang", 6) || at("col--language", 6));
  const submittedAt =
    attr(row, "data-submit-time") ??
    attr(row, "data-timestamp") ??
    textOf(at("col--submit-time", 8));
  return {
    id: idMatch[1]!,
    ...problem,
    result: result || undefined,
    score: scoreValue ?? (scoreMatch ? Number(scoreMatch[1]) : undefined),
    timeMs,
    memoryKb,
    language: lang || undefined,
    codeLength: sizeBytes(at("col--file-size", 7) || at("col--size", 7)),
    submittedAt: submittedAt || undefined,
  };
}

export function isQOJLoginPage(text: string, url?: string): boolean {
  return (
    /\/login(?:[/?#]|$)/i.test(url ?? "") ||
    /<title>[^<]*(?:login|登录|登入)[^<]*<\/title>/i.test(text) ||
    /<input\b[^>]*name=["']username["'][^>]*>[\s\S]*?<input\b[^>]*name=["']password["']/i.test(
      text,
    )
  );
}

/**
 * QOJ is currently behind Cloudflare. A service-worker request can receive
 * the challenge document even when it reuses the browser cookie store.
 * Only challenge documents should be treated as site errors.
 */
export function isQOJCloudflarePage(text: string): boolean {
  // Cloudflare also injects /challenge-platform/scripts/jsd/main.js into
  // ordinary, authenticated QOJ HTML. That URL alone is not a challenge.
  const visibleHtml = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return (
    /<title\b[^>]*>\s*(?:just a moment(?:\.{3}|…)?|attention required!?(?:\s*\|\s*cloudflare)?)\s*<\/title>/i.test(
      visibleHtml,
    ) ||
    /enable javascript and cookies to continue/i.test(textOf(visibleHtml)) ||
    /(?:window\.)?_cf_chl_opt\s*=/.test(text)
  );
}

export function parseQOJIdentity(text: string): string | undefined {
  // Never take an account identity from submissions or embedded JS examples.
  const identityHtml = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<table\b[\s\S]*?<\/table>/gi, " ");
  for (const navigation of ulBlocks(identityHtml)) {
    if (!/<a\b[^>]*href=["'][^"']*\/logout(?:[?"'])/i.test(navigation)) {
      continue;
    }
    const identity = dropdownIdentity(navigation);
    if (identity) return identity;
  }

  // Some QOJ deployments omit the outer nav <ul> in the server-rendered
  // fragment but keep the authenticated dropdown marker. Restrict this
  // fallback to the username marker; table usernames have been removed.
  if (/<a\b[^>]*href=["'][^"']*\/logout(?:[?"'])/i.test(identityHtml)) {
    const dropdown = identityHtml.match(
      /<a\b(?=[^>]*data-toggle=["']dropdown["'])[^>]*>[\s\S]{0,2000}?<\/a>/i,
    )?.[0];
    const identity = dropdown ? dropdownIdentity(dropdown) : undefined;
    if (identity) return identity;

    // QOJ themes can put the same authenticated marker in a div/header.
    const navigation = identityHtml.slice(
      0,
      identityHtml.search(/<a\b[^>]*href=["'][^"']*\/logout(?:[?"'])/i),
    );
    const span = usernameSpanIdentity(navigation);
    if (span) return span;
    const profile =
      profileIdentity(navigation) ?? profileLinkIdentity(navigation);
    if (profile) return profile;
    const anchor = navigation.match(
      /<a\b(?=[^>]*class=["'][^"']*\buoj-username\b[^"']*["'])[^>]*>([\s\S]*?)<\/a>/i,
    );
    const anchorHref = anchor ? attr(anchor[0], "href") : undefined;
    if (anchor && (!anchorHref || anchorHref === "#")) {
      const value = textOf(anchor[1]);
      if (value && !/^guest$/i.test(value)) return value;
    }
  }
  return undefined;
}

export function parseQOJRecordPage(text: string, url = ""): QOJRecordPage {
  if (isQOJLoginPage(text, url))
    throw new Error("QOJ response is a login page");
  const listPage =
    /\/submissions(?:[/?#]|$)/i.test(url) ||
    /<title>[^<]*submissions[^<]*<\/title>/i.test(text) ||
    /id=["']form-search["'][\s\S]*name=["']submitter["']/i.test(text);
  if (!listPage || !/<(?:table|tbody)\b/i.test(text)) {
    throw new Error("QOJ response is not a submissions page");
  }
  const currentPage = Number(url.match(/[?&]page=(\d+)/i)?.[1] ?? 1);
  const records = [...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => rowRecord(match[0]!))
    .filter((record): record is QOJRawRecord => Boolean(record));
  const pages = [...text.matchAll(/(?:[?&]|&amp;)page=(\d+)/gi)].map((match) =>
    Number(match[1]),
  );
  const hasMore =
    pages.some((page) => page > currentPage) ||
    /(?:class=["'][^"']*(?:next|forward)[^"']*["'][^>]*href|rel=["']next["'])/i.test(
      text,
    );
  return {
    page: currentPage,
    records,
    hasMore,
    username: parseQOJIdentity(text),
  };
}
