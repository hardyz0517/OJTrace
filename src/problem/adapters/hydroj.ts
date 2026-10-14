import type { ProblemAdapter } from "../adapter";
import type {
  ProblemExtractionResult,
  ProblemPageProbe,
  ProblemPageSnapshot,
  ProblemPreview,
} from "../domain";
import {
  extractDocument,
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
      attr(node, "data-marker-enabled") !== undefined,
  );
}

/**
 * Hydro injects contest and system callouts into the statement fragment
 * (`blockquote.note` / `blockquote.warn`). They are not part of the problem.
 */
function stripHydroChrome(statement: HtmlElementNode): void {
  removeNodes(
    statement,
    (node) =>
      node.tagName === "blockquote" &&
      (hasClass(node, "note") || hasClass(node, "warn")),
  );
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
  async extract(
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
    return extractDocument({
      source: "hydroj",
      snapshot,
      problemId: idFromUrl(snapshot.url, URL_PATTERNS),
      title: rootTitle(root) ?? snapshot.title,
      root: statement,
      language: snapshotLanguage(snapshot) ?? snapshot.language ?? "other",
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
