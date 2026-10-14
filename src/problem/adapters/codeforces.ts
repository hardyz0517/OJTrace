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
  memoryText,
  parseProbe,
  parseSnapshot,
  preview,
  rootTitle,
  textFromClass,
  timeText,
} from "./common";
import {
  findFirst,
  hasClass,
  type HtmlElementNode,
  type HtmlRootNode,
} from "../extract/html-document";

const URL_PATTERNS = [
  /^\/problemset\/problem\/([^/]+)\/([^/?#]+)\/?$/i,
  /^\/(?:contest|gym)\/([^/]+)\/problem\/([^/?#]+)\/?$/i,
  /^\/problemset\/gymProblem\/([^/]+)\/([^/?#]+)\/?$/i,
];

interface CodeforcesProblemRoute {
  contestId: string;
  index: string;
}

function problemRoute(url: string): CodeforcesProblemRoute | undefined {
  try {
    const parsed = new URL(url);
    for (const pattern of URL_PATTERNS) {
      const match = parsed.pathname.match(pattern);
      if (match?.[1] && match[2])
        return {
          contestId: decodeURIComponent(match[1]),
          index: decodeURIComponent(match[2]),
        };
    }
  } catch {
    // The adapter's match method handles malformed URLs.
  }
  return undefined;
}

function codeforcesStatement(root: HtmlRootNode): HtmlElementNode | undefined {
  return findRoot(root, { classes: ["problem-statement"] });
}

function codeforcesHeader(
  statement: HtmlElementNode,
): HtmlElementNode | undefined {
  return findFirst(statement, (node) => hasClass(node, "header"));
}

/**
 * Codeforces wraps the actual statement in an outer `.problem-statement`
 * alongside `.header` on some templates.  Keep metadata on the outer node,
 * but only pass the body node to the generic extractor so the title and limits
 * are not repeated in the document body.
 */
function stripInputOutputCopiers(node: HtmlElementNode): void {
  const clean = (current: HtmlElementNode): void => {
    current.children = current.children.filter((child) => {
      if (child.type !== "element") return true;
      if (hasClass(child, "input-output-copier")) return false;
      clean(child);
      return true;
    });
  };
  clean(node);
}

function codeforcesBody(statement: HtmlElementNode): HtmlElementNode {
  const nested = findFirst(statement, (node) =>
    hasClass(node, "problem-statement"),
  );
  if (nested) return nested;
  const bodyChildren = statement.children.filter((child) => {
    if (child.type !== "element") return true;
    return ![
      "header",
      "time-limit",
      "memory-limit",
      "input-file",
      "output-file",
    ].some((className) => hasClass(child, className));
  });
  if (bodyChildren.length === statement.children.length) return statement;
  return { ...statement, children: bodyChildren };
}

export const codeforcesProblemAdapter: ProblemAdapter = {
  oj: "codeforces",
  match(url) {
    try {
      const parsed = new URL(url);
      return Boolean(
        /(^|\.)codeforces\.com$/i.test(parsed.hostname) &&
        URL_PATTERNS.some((pattern) => pattern.test(parsed.pathname)),
      );
    } catch {
      return false;
    }
  },
  async inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined> {
    if (!this.match(probe.url)) return undefined;
    const root = parseProbe(probe);
    const statement = codeforcesStatement(root);
    const route = problemRoute(probe.url);
    if (!statement || !route) return undefined;
    const header = codeforcesHeader(statement);
    const title = rootTitle(header ?? statement) ?? probe.title;
    return preview(
      "codeforces",
      probe,
      `${route.contestId}${route.index}`,
      title,
      "en",
    );
  },
  async extract(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult> {
    if (!this.match(snapshot.url))
      return { ok: false, reason: "unsupported-url" };
    const root = parseSnapshot(snapshot);
    const statement = codeforcesStatement(root);
    const route = problemRoute(snapshot.url);
    if (!statement || !route)
      return { ok: false, reason: "statement-not-found" };
    const header = codeforcesHeader(statement);
    const title = rootTitle(header ?? statement) ?? snapshot.title;
    const body = codeforcesBody(statement);
    stripInputOutputCopiers(body);
    return extractDocument({
      source: "codeforces",
      snapshot,
      problemId: `${route.contestId}${route.index}`,
      title,
      root: body,
      language: "en",
      timeText: textFromClass(statement, ["time-limit"]) ?? timeText(statement),
      memoryText:
        textFromClass(statement, ["memory-limit"]) ?? memoryText(statement),
    });
  },
};
