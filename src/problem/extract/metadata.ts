import {
  attr,
  findAll,
  type HtmlElementNode,
  type HtmlRootNode,
  trimmedText,
} from "./html-document";
import type { ProblemLimit } from "../domain";

const TIME_QUANTITY =
  /([\d.]+)\s*(milliseconds?|ms|seconds?|sec|minutes?|mins?|分钟|秒|s)/i;
const MEMORY_QUANTITY =
  /([\d.]+)\s*(kibibytes?|kilobytes?|mebibytes?|megabytes?|gibibytes?|gigabytes?|KiB|MiB|GiB|KB|MB|GB|bytes?|字节|兆|B|G)/i;

/**
 * Page headers already say 时间限制 / 内存限制. Keep a bare quantity such as
 * "4 seconds", and drop a repeated English label ("time limit per test").
 * A value that is already just the quantity stays unchanged, including "2 sec".
 */
function quantityDisplay(display: string, match: RegExpMatchArray): string {
  const quantity = match[0].replace(/\s+/g, " ").trim();
  const leftover = display
    .replace(match[0], " ")
    .replace(/[\s:：/|,_·\-\u2013\u2014]+/g, " ")
    .trim();
  return /\d/.test(leftover) ? display : quantity;
}

export function parseTimeLimit(
  value: string | undefined,
): ProblemLimit | undefined {
  const display = value?.replace(/\s+/g, " ").trim();
  if (!display) return undefined;
  const match = display.match(TIME_QUANTITY);
  if (!match?.[1] || !match[2]) return { display };
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return { display };
  const unit = match[2].toLowerCase();
  const milliseconds =
    unit.startsWith("ms") || unit.startsWith("mill")
      ? amount
      : unit === "分钟" || unit.startsWith("min")
        ? amount * 60_000
        : unit === "秒" || unit.startsWith("s")
          ? amount * 1_000
          : undefined;
  const shown = quantityDisplay(display, match);
  return milliseconds === undefined
    ? { display: shown }
    : { display: shown, milliseconds };
}

export function parseMemoryLimit(
  value: string | undefined,
): ProblemLimit | undefined {
  const display = value?.replace(/\s+/g, " ").trim();
  if (!display) return undefined;
  const match = display.match(MEMORY_QUANTITY);
  if (!match?.[1] || !match[2]) return { display };
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return { display };
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "b" || unit === "byte" || unit === "bytes" || unit === "字节"
      ? 1
      : unit === "kib" ||
          unit === "kb" ||
          unit.startsWith("kibibyte") ||
          unit.startsWith("kilobyte")
        ? 1024
        : unit === "mib" ||
            unit === "mb" ||
            unit.startsWith("mebibyte") ||
            unit.startsWith("megabyte") ||
            unit === "兆"
          ? 1024 ** 2
          : 1024 ** 3;
  return {
    display: quantityDisplay(display, match),
    bytes: amount * multiplier,
  };
}

export function problemIdFromUrl(
  url: string,
  patterns: readonly RegExp[],
): string | undefined {
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return undefined;
}

export function findLimitByLabels(
  root: HtmlRootNode | HtmlElementNode,
  labels: readonly RegExp[],
): string | undefined {
  const nodes = findAll(root, (item) => {
    const text = trimmedText(item);
    return labels.some((label) => label.test(text)) && text.length < 240;
  });
  const candidates: string[] = [];
  for (const node of nodes) {
    const own = valueAfterLabel(cleanLimitText(trimmedText(node)), labels);
    if (own) candidates.push(own);
    const dataValue = attr(node, "data-value");
    if (dataValue && /\d/.test(dataValue))
      candidates.push(cleanLimitText(dataValue));
    for (const sibling of followingShortTexts(node)) {
      const quantity = sibling.match(LIMIT_UNIT)?.[0];
      if (quantity) candidates.push(cleanLimitText(quantity));
    }
  }
  return candidates
    .map((value) => value.trim())
    .filter(
      (value) => value.length > 0 && value.length < 40 && limitScore(value) > 0,
    )
    .sort(
      (left, right) =>
        limitScore(right) - limitScore(left) || left.length - right.length,
    )[0];
}

const LIMIT_UNIT =
  /([\d.]+)\s*(?:milliseconds?|ms|seconds?|sec|s|minutes?|min|分钟|秒|kibibytes?|kilobytes?|KiB|KB|mebibytes?|megabytes?|MiB|MB|gibibytes?|gigabytes?|GiB|GB|bytes?|字节|兆)/i;

function cleanLimitText(value: string): string {
  return value.replace(/[-]/g, "").replace(/\s+/g, " ").trim();
}

function limitScore(value: string): number {
  if (!/\d/.test(value)) return 0;
  return LIMIT_UNIT.test(value) ? 3 : 1;
}

function valueAfterLabel(
  text: string,
  labels: readonly RegExp[],
): string | undefined {
  let start = -1;
  let index = -1;
  for (const label of labels) {
    const probe = new RegExp(label.source, label.flags.replace("g", ""));
    const match = probe.exec(text);
    if (!match || match.index === undefined) continue;
    const matchEnd = match.index + match[0].length;
    if (start < 0 || match.index < start) {
      start = match.index;
      index = matchEnd;
    }
  }
  if (index < 0) return undefined;
  const rest = text.slice(index).replace(/^[^:\d]*[:：]?\s*/, "");
  const quantity = rest.match(LIMIT_UNIT)?.[0];
  if (quantity && rest.indexOf(quantity) < 24) return cleanLimitText(quantity);
  return undefined;
}

function followingShortTexts(node: HtmlElementNode): string[] {
  const siblings = node.parent?.children ?? [];
  const index = siblings.indexOf(node);
  const texts: string[] = [];
  for (
    let cursor = index + 1;
    cursor < siblings.length && texts.length < 3;
    cursor += 1
  ) {
    const sibling = siblings[cursor];
    if (!sibling || sibling.type !== "element") continue;
    const text = cleanLimitText(trimmedText(sibling));
    if (!text || text.length > 40) break;
    texts.push(text);
  }
  return texts;
}

export function cleanTitle(value: string | undefined): string | undefined {
  const title = value?.replace(/\s+/g, " ").trim();
  if (!title) return undefined;
  return title
    .replace(/\s*[-|｜]\s*(洛谷|Codeforces|AtCoder|QOJ|HydroOJ).*$/i, "")
    .trim();
}
