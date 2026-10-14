import type { ProblemAdapter } from "../adapter";
import type {
  ProblemExtractionResult,
  ProblemPageProbe,
  ProblemPageSnapshot,
  ProblemPreview,
} from "../domain";
import {
  extractDocument,
  findRoot,
  idFromUrl,
  looksLikeLoginOrChallenge,
  pageText,
  parseProbe,
  parseSnapshot,
  preview,
  textFromClass,
} from "./common";
import { findLimitByLabels } from "../extract/metadata";
import {
  attr,
  findFirst,
  hasClass,
  trimmedText,
  type HtmlElementNode,
  type HtmlRootNode,
} from "../extract/html-document";

/**
 * QOJ follows the UOJ page template, but `.uoj-content` is the whole problem
 * shell: limit badges, the problem title, tabs, contest
 * history, and every tab pane. The statement itself is the article inside
 * `#tab-statement`. A bare `.uoj-content` match is only a fallback for
 * simplified pages that put the statement directly in that container.
 */
function qojStatementRoot(root: HtmlRootNode): HtmlElementNode | undefined {
  const statementTab = findFirst(
    root,
    (node) => attr(node, "id") === "tab-statement",
  );
  if (statementTab) {
    return (
      findFirst(
        statementTab,
        (node) =>
          node.tagName === "article" ||
          hasClass(node, "uoj-article") ||
          hasClass(node, "top-buffer-md"),
      ) ?? statementTab
    );
  }

  const article = findFirst(
    root,
    (node) =>
      node.tagName === "article" &&
      (hasClass(node, "uoj-article") || hasClass(node, "top-buffer-md")),
  );
  if (article) return article;

  const marked = findRoot(root, {
    classes: ["problem-statement", "problem-content"],
    ids: ["problem-statement", "problem-content"],
  });
  if (marked) return marked;

  const plainArticle = findFirst(root, (node) => node.tagName === "article");
  if (plainArticle) return plainArticle;

  const shell = findFirst(root, (node) => hasClass(node, "uoj-content"));
  if (!shell || qojShellHasPageChrome(shell)) return undefined;
  return shell;
}

function qojShellHasPageChrome(shell: HtmlElementNode): boolean {
  return Boolean(
    findFirst(
      shell,
      (node) =>
        hasClass(node, "nav-tabs") ||
        hasClass(node, "page-header") ||
        attr(node, "id") === "tab-statement",
    ),
  );
}

function qojTitle(root: HtmlRootNode, fallback: string): string {
  const header = findFirst(
    root,
    (node) => node.tagName === "h1" && hasClass(node, "page-header"),
  );
  return (
    normalizeQojTitle(header ? trimmedText(header) : "") ||
    normalizeQojTitle(fallback)
  );
}

function normalizeQojTitle(value: string): string {
  const withoutSite = value
    .replace(
      /\s*[-|｜]\s*(?:(?:题目|problem|題目)\s*[-|｜]\s*)?(?:QOJ(?:\.ac)?|Universal Online Judge|UOJ)\s*$/i,
      "",
    )
    .trim();
  const withoutId = withoutSite
    .replace(/^\s*#\s*\d+\s*[.。．、:]?\s*/, "")
    .trim();
  if (
    !withoutId ||
    /^(?:QOJ(?:\.ac)?|UOJ|Universal Online Judge)$/i.test(withoutId)
  )
    return "";
  return withoutId;
}

function qojBody(statement: HtmlElementNode): HtmlElementNode {
  const children = statement.children.filter((child) => {
    if (child.type !== "element") return true;
    if (child.tagName === "script" || child.tagName === "style") return false;
    if (child.tagName === "h1") {
      const text = trimmedText(child);
      return !hasClass(child, "page-header") && !/^\s*#?\d+\s*[.)]/.test(text);
    }
    return !isQojChrome(child);
  });
  return children.length === statement.children.length
    ? statement
    : { ...statement, children };
}

function isQojChrome(node: HtmlElementNode): boolean {
  if (node.tagName === "nav") return true;
  return [
    "nav",
    "nav-tabs",
    "alert",
    "btn",
    "uoj-click-zan-block",
    "uoj-favourite-block",
  ].some((name) => hasClass(node, name));
}

const LIMIT_QUANTITY =
  /([\d.]+)\s*(?:milliseconds?|ms|seconds?|sec|s|minutes?|min|分钟|秒|kibibytes?|kilobytes?|KiB|KB|mebibytes?|megabytes?|MiB|MB|gibibytes?|gigabytes?|GiB|GB|bytes?|字节|兆)/i;

function limitQuantity(text: string | undefined): string | undefined {
  const match = text?.replace(/\s+/g, " ").match(LIMIT_QUANTITY);
  return match?.[0]?.replace(/\s+/g, " ").trim();
}

function qojMeasuredLimit(
  root: HtmlRootNode,
  statement: HtmlElementNode,
  classes: readonly string[],
  label: RegExp,
): string | undefined {
  const badge = findFirst(
    root,
    (node) =>
      hasClass(node, "badge") &&
      label.test(trimmedText(node)) &&
      trimmedText(node).length < 80,
  );
  return (
    limitQuantity(badge ? trimmedText(badge) : undefined) ??
    limitQuantity(textFromClass(statement, classes)) ??
    findLimitByLabels(root, [label])
  );
}

const URL_PATTERNS = [
  /\/problem\/([^/?#]+)/i,
  /\/contest\/[^/]+\/problem\/([^/?#]+)/i,
];

export const qojProblemAdapter: ProblemAdapter = {
  oj: "qoj",
  match(url) {
    try {
      const parsed = new URL(url);
      return (
        /(^|\.)qoj\.ac$/i.test(parsed.hostname) &&
        URL_PATTERNS.some((pattern) => pattern.test(parsed.pathname))
      );
    } catch {
      return false;
    }
  },
  async inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined> {
    if (!this.match(probe.url)) return undefined;
    const root = parseProbe(probe);
    if (looksLikeLoginOrChallenge(root)) return undefined;
    const statement = qojStatementRoot(root);
    if (!statement) return undefined;
    return preview(
      "qoj",
      probe,
      idFromUrl(probe.url, URL_PATTERNS),
      qojTitle(root, probe.title),
      "en",
    );
  },
  async extract(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult> {
    if (!this.match(snapshot.url))
      return { ok: false, reason: "unsupported-url" };
    const root = parseSnapshot(snapshot);
    if (looksLikeLoginOrChallenge(root))
      return { ok: false, reason: "challenge-page" };
    const statement = qojStatementRoot(root);
    if (!statement) return { ok: false, reason: "statement-not-found" };
    const body = qojBody(statement);
    return extractDocument({
      source: "qoj",
      snapshot,
      problemId: idFromUrl(snapshot.url, URL_PATTERNS),
      title: qojTitle(root, snapshot.title),
      root: body,
      language: snapshot.language ?? "en",
      timeText: qojMeasuredLimit(
        root,
        body,
        ["time-limit", "uoj-time-limit"],
        /time|时间|制限時間/i,
      ),
      memoryText: qojMeasuredLimit(
        root,
        body,
        ["memory-limit", "uoj-memory-limit"],
        /memory|内存|空间|メモリ/i,
      ),
      warnings:
        pageText(body).length < 80
          ? [
              {
                code: "short-statement",
                message: "题面内容较短，请确认页面已加载完成。",
              },
            ]
          : [],
    });
  },
};
