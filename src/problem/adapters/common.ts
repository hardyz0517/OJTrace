import type {
  ProblemDocument,
  ProblemExtractionResult,
  ProblemLanguage,
  ProblemPageProbe,
  ProblemPageSnapshot,
  ProblemPreview,
  ProblemWarning,
} from "../domain";
import { problemDisplayName } from "../domain";
import type { SourceId } from "../../domain/types";
import {
  attr,
  findFirst,
  hasClass,
  parseHtmlDocument,
  serializeNode,
  trimmedText,
  type HtmlElementNode,
  type HtmlRootNode,
} from "../extract/html-document";
import { htmlToStatement } from "../extract/html-to-statement";
import { mergeCapturedImages } from "../merge-images";
import { serializeMarkdown } from "../extract/markdown-serializer";
import {
  cleanTitle,
  findLimitByLabels,
  parseMemoryLimit,
  parseTimeLimit,
  problemIdFromUrl,
} from "../extract/metadata";

export function parseSnapshot(snapshot: ProblemPageSnapshot): HtmlRootNode {
  return parseHtmlDocument(snapshot.html);
}

export function parseProbe(probe: ProblemPageProbe): HtmlRootNode {
  return parseHtmlDocument(probe.htmlFragment);
}

export function preview(
  source: SourceId,
  probe: ProblemPageProbe,
  problemId: string | undefined,
  title: string | undefined,
  language?: ProblemLanguage,
): ProblemPreview | undefined {
  const id = problemId?.trim();
  const normalizedTitle = cleanTitle(title);
  if (!id || !normalizedTitle) return undefined;
  return {
    oj: source,
    ojDisplayName: problemDisplayName(source),
    problemId: id,
    title: normalizedTitle,
    originalUrl: probe.url,
    ...(language ? { language } : {}),
  };
}

export function extractDocument(input: {
  source: SourceId;
  snapshot: ProblemPageSnapshot;
  problemId?: string;
  title?: string;
  root: HtmlElementNode;
  language?: ProblemLanguage;
  timeText?: string;
  memoryText?: string;
  warnings?: ProblemWarning[];
}): ProblemExtractionResult {
  const problemId = input.problemId?.trim();
  const title = cleanTitle(input.title);
  if (!problemId || !title) return { ok: false, reason: "ambiguous-problem" };
  const extraction = htmlToStatement(
    serializeNode(input.root),
    input.snapshot.baseUrl,
    input.language,
  );
  if (extraction.blocks.length === 0)
    return { ok: false, reason: "statement-not-found" };
  const merged = mergeCapturedImages(
    extraction.assets,
    [...(input.warnings ?? []), ...extraction.warnings],
    input.snapshot.imageAssets,
    input.snapshot.imageWarnings,
  );
  const warnings = merged.warnings;
  const assets = merged.assets;
  const document: ProblemDocument = {
    oj: input.source,
    problemId,
    title,
    originalUrl: input.snapshot.url,
    ...(parseTimeLimit(input.timeText)
      ? { timeLimit: parseTimeLimit(input.timeText) }
      : {}),
    ...(parseMemoryLimit(input.memoryText)
      ? { memoryLimit: parseMemoryLimit(input.memoryText) }
      : {}),
    blocks: extraction.blocks,
    markdown: serializeMarkdown(extraction.blocks),
    ...(input.language ? { language: input.language } : {}),
    assets,
    warnings,
  };
  return { ok: true, document };
}

export function findRoot(
  root: HtmlRootNode,
  options: {
    ids?: readonly string[];
    classes?: readonly string[];
    tags?: readonly string[];
  },
): HtmlElementNode | undefined {
  return findFirst(
    root,
    (node) =>
      (options.ids?.includes(attr(node, "id") ?? "") ?? false) ||
      (options.classes?.some((name) => hasClass(node, name)) ?? false) ||
      (options.tags?.includes(node.tagName) ?? false),
  );
}

export function pageText(root: HtmlRootNode | HtmlElementNode): string {
  return trimmedText(root);
}

export function rootTitle(
  root: HtmlRootNode | HtmlElementNode,
): string | undefined {
  const heading =
    findFirst(
      root,
      (node) =>
        node.tagName === "h1" ||
        hasClass(node, "title") ||
        hasClass(node, "problem-title") ||
        hasClass(node, "heading"),
    ) ?? findFirst(root, (node) => node.tagName === "h2");
  return heading ? trimmedText(heading) : undefined;
}

export function timeText(
  root: HtmlRootNode | HtmlElementNode,
): string | undefined {
  return findLimitByLabels(root as HtmlElementNode, [/time|时间|制限時間/i]);
}

export function memoryText(
  root: HtmlRootNode | HtmlElementNode,
): string | undefined {
  return findLimitByLabels(root as HtmlElementNode, [/memory|内存|メモリ/i]);
}

export function textFromClass(
  root: HtmlRootNode | HtmlElementNode,
  classes: readonly string[],
): string | undefined {
  const node = findFirst(root, (item) =>
    classes.some((name) => hasClass(item, name)),
  );
  return node ? trimmedText(node) : undefined;
}

export function idFromUrl(
  url: string,
  patterns: readonly RegExp[],
): string | undefined {
  return problemIdFromUrl(url, patterns);
}

export function looksLikeLoginOrChallenge(root: HtmlRootNode): boolean {
  const text = pageText(root).toLowerCase();
  return /(cloudflare|checking your browser|please log in|登录后|sign in to continue|access denied)/i.test(
    text,
  );
}
