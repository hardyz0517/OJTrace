import type {
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
import { htmlToAst } from "../markdown/html";
import { inferFigureCaptions } from "../extract/figure-layout";
import { parseMarkdown, markdownAssets } from "../markdown/parse";
import { mergeCapturedImages } from "../merge-images";
import { serializeMarkdown } from "../markdown/serialize";
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

/** Produce the only source of statement content; temporary trees never escape. */
export function extractSourceDocument(input: {
  source: SourceId;
  snapshot: ProblemPageSnapshot;
  problemId?: string;
  title?: string;
  root?: HtmlElementNode;
  sourceMarkdown?: string;
  language?: ProblemLanguage;
  timeText?: string;
  memoryText?: string;
  warnings?: ProblemWarning[];
}): ProblemExtractionResult {
  const problemId = input.problemId?.trim();
  const title = cleanTitle(input.title);
  if (!problemId || !title) return { ok: false, reason: "ambiguous-problem" };
  const metadata = {
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
    ...(input.language ? { language: input.language } : {}),
  };
  try {
    const parsed =
      input.sourceMarkdown != null
        ? parseMarkdown(input.sourceMarkdown, {
            baseUrl: input.snapshot.baseUrl,
          })
        : (() => {
            if (!input.root) throw new Error("Source root is missing");
            // HTML parsing owns script/style filtering and recognizes TeX scripts.
            // Adapter cleanup must not erase formula sources before that parse.
            const value = htmlToAst(
              serializeNode(input.root),
              input.snapshot.baseUrl,
            );
            return {
              ast: {
                type: "root" as const,
                children: inferFigureCaptions(value.blocks),
              },
              warnings: value.warnings,
            };
          })();
    const sourceMarkdown =
      input.sourceMarkdown ?? serializeMarkdown(parsed.ast.children);
    if (!sourceMarkdown.trim())
      return { ok: false, reason: "statement-not-found" };
    const merged = mergeCapturedImages(
      "assets" in parsed ? parsed.assets : markdownAssets(parsed.ast),
      [...(input.warnings ?? []), ...parsed.warnings],
      input.snapshot.imageAssets,
      input.snapshot.imageWarnings,
    );
    return {
      ok: true,
      source: {
        metadata,
        sourceMarkdown,
        assets: merged.assets,
        warnings: merged.warnings,
      },
    };
  } catch (error) {
    if (input.sourceMarkdown?.trim())
      return {
        ok: true,
        source: {
          metadata,
          sourceMarkdown: input.sourceMarkdown,
          assets: [],
          warnings: [
            ...(input.warnings ?? []),
            {
              code: "source-syntax-incomplete",
              message:
                error instanceof Error
                  ? error.message
                  : "源 Markdown 无法完整解析。",
            },
          ],
        },
      };
    return {
      ok: false,
      reason: error instanceof RangeError ? "size-limit" : "invalid-snapshot",
      message:
        error instanceof SyntaxError
          ? error.message
          : "题面无法完整提取，请检查页面或内容规模。",
    };
  }
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
