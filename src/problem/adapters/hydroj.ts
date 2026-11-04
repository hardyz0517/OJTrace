import { inferProblemLanguage, normalizeProblemLanguage } from "../language";
import type { ProblemAdapter } from "../adapter";
import type {
  ProblemExtractionResult,
  ProblemPageProbe,
  ProblemPageSnapshot,
  ProblemPreview,
} from "../domain";
import {
  extractSourceDocument,
  idFromUrl,
  looksLikeLoginOrChallenge,
  parseProbe,
  parseSnapshot,
  preview,
  rootTitle,
  textFromClass,
  timeText,
  memoryText,
} from "./common";
import {
  attr,
  findFirst,
  hasClass,
  removeNodes,
  trimmedText,
  type HtmlElementNode,
  type HtmlRootNode,
} from "../extract/html-document";

const URL_PATTERNS = [
  /\/p\/([^/?#]+)/i,
  /\/d\/[^/]+\/p\/([^/?#]+)/i,
  /\/(?:contest|homework)\/[^/]+\/(?:p|problem)\/([^/?#]+)/i,
];

function isHydroHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      /^https?:$/i.test(parsed.protocol) &&
      URL_PATTERNS.some((pattern) => pattern.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

/**
 * Hydro's default UI marks the statement body with `data-fragment-id` or
 * `.problem-content[data-marker-enabled]`. Require one of these platform
 * markers on arbitrary hosts; generic tags/classes such as `main`, `article`,
 * `markdown-body`, and unmarked `.problem-content` are not enough.
 */
function hydroRoot(root: HtmlRootNode): HtmlElementNode | undefined {
  const marked = findFirst(
    root,
    (node) => attr(node, "data-fragment-id") === "problem-description",
  );
  if (marked) return marked;
  return findFirst(
    root,
    (node) =>
      hasClass(node, "problem-content") &&
      Object.hasOwn(node.attrs, "data-marker-enabled"),
  );
}

/**
 * Known UI notices precede rendered content in Hydro's default template:
 * https://github.com/hydro-dev/Hydro/blob/master/packages/ui-default/templates/partials/problem_description.html
 * A note/warn class alone is insufficient evidence to remove author content.
 */
function stripHydroChrome(statement: HtmlElementNode): void {
  // Hydro's Prism highlighter wraps code and adds Copy/Fill-to-Pretest UI.
  // A toolbar outside this generated wrapper can be authored problem content.
  removeNodes(
    statement,
    (node) =>
      hasClass(node, "toolbar") &&
      !!node.parent &&
      hasClass(node.parent, "code-toolbar") &&
      node.parent.children.some(
        (child) => child.type === "element" && child.tagName === "pre",
      ),
  );
  let prefix = true;
  statement.children = statement.children.filter((node) => {
    if (node.type === "text" && !node.value.trim()) return true;
    if (
      node.type === "element" &&
      prefix &&
      node.tagName === "blockquote" &&
      (hasClass(node, "note") || hasClass(node, "warn"))
    ) {
      const text = trimmedText(node);
      if (
        /^No\s+testdata\s+at\s+current\./i.test(text) ||
        /^No submission language\b/i.test(text) ||
        (/^(?:You cannot submit|The contest)\b/i.test(text) &&
          /contest.*ended/i.test(text)) ||
        /^(?:暂无测试数据[。.]|该比赛已结束，您无法在比赛模式下递交|比赛已结束)/u.test(
          text,
        )
      )
        return false;
    }
    prefix = false;
    return true;
  });
}

function looksLikeHydroChallenge(root: HtmlRootNode): boolean {
  const text = trimmedText(root).toLowerCase();
  return /(cerberus|anubis|captcha|not a bot|proof[- ]of[- ]work|verify you are human)/i.test(
    text,
  );
}

function hydroTimeText(
  root: HtmlRootNode,
  statement: HtmlElementNode,
): string | undefined {
  return (
    textFromClass(statement, ["time-limit", "problem-time-limit"]) ??
    textFromClass(root, [
      "time-limit",
      "problem-time-limit",
      "icon-stopwatch",
    ]) ??
    timeText(root)
  );
}

function hydroMemoryText(
  root: HtmlRootNode,
  statement: HtmlElementNode,
): string | undefined {
  return (
    textFromClass(statement, ["memory-limit", "problem-memory-limit"]) ??
    textFromClass(root, [
      "memory-limit",
      "problem-memory-limit",
      "icon-comparison",
    ]) ??
    memoryText(root)
  );
}

export const hydrojProblemAdapter: ProblemAdapter = {
  oj: "hydroj",
  match: isHydroHost,
  async inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined> {
    if (!this.match(probe.url)) return undefined;
    const root = parseProbe(probe);
    if (looksLikeLoginOrChallenge(root) || looksLikeHydroChallenge(root))
      return undefined;
    const statement = hydroRoot(root);
    if (!statement) return undefined;
    stripHydroChrome(statement);
    const text = trimmedText(statement);
    if (text.length < 40) return undefined;
    return preview(
      "hydroj",
      probe,
      idFromUrl(probe.url, URL_PATTERNS),
      rootTitle(root) ?? probe.title,
      snapshotLanguage(probe),
    );
  },
  async extractSource(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult> {
    if (!this.match(snapshot.url))
      return { ok: false, reason: "unsupported-url" };
    const root = parseSnapshot(snapshot);
    if (looksLikeLoginOrChallenge(root) || looksLikeHydroChallenge(root))
      return { ok: false, reason: "challenge-page" };
    const statement = hydroRoot(root);
    if (!statement) return { ok: false, reason: "statement-not-found" };
    stripHydroChrome(statement);
    if (trimmedText(statement).length < 40)
      return { ok: false, reason: "page-not-ready" };
    return extractSourceDocument({
      source: "hydroj",
      snapshot,
      problemId: idFromUrl(snapshot.url, URL_PATTERNS),
      title: rootTitle(root) ?? snapshot.title,
      root: statement,
      language:
        normalizeProblemLanguage(attr(statement, "lang")) ??
        inferProblemLanguage(trimmedText(statement)) ??
        snapshotLanguage(snapshot) ??
        snapshot.language ??
        "other",
      timeText: hydroTimeText(root, statement),
      memoryText: hydroMemoryText(root, statement),
    });
  },
};

function snapshotLanguage(input: {
  url: string;
}): "zh" | "en" | "ja" | "other" | undefined {
  try {
    const value = new URL(input.url).searchParams.get("lang")?.toLowerCase();
    return value === "zh" || value === "en" || value === "ja"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
