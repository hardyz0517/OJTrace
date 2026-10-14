import type { ProblemAdapter } from "../adapter";
import type {
  ProblemLanguage,
  ProblemExtractionResult,
  ProblemPageProbe,
  ProblemPageSnapshot,
  ProblemPreview,
} from "../domain";
import {
  extractDocument,
  findRoot,
  idFromUrl,
  memoryText,
  parseProbe,
  parseSnapshot,
  preview,
  textFromClass,
  timeText,
} from "./common";
import { normalizeProblemLanguage } from "../language";
import {
  attr,
  findAll,
  findFirst,
  hasClass,
  removeNodes,
  trimmedText,
  type HtmlElementNode,
  type HtmlRootNode,
} from "../extract/html-document";

const URL_PATTERNS = [
  /\/contests\/[^/]+\/tasks\/([^/?#]+)/i,
  /\/tasks\/([^/?#]+)/i,
];

function languageFromUrl(url: string): "en" | "ja" | undefined {
  try {
    const value = new URL(url).searchParams.get("lang")?.toLowerCase();
    return value === "en" || value === "ja" ? value : undefined;
  } catch {
    return undefined;
  }
}

function japaneseLimitText(
  root: HtmlRootNode | HtmlElementNode,
  kind: "time" | "memory",
): string | undefined {
  const label =
    kind === "time"
      ? /(?:実行時間制限|時間制限|制限時間)\s*[:：]?/i
      : /(?:メモリ制限|記憶容量制限|メモリ)\s*[:：]?/i;
  const otherLabel =
    kind === "time"
      ? /(?:メモリ制限|記憶容量制限|メモリ)/i
      : /(?:実行時間制限|時間制限|制限時間)/i;
  const otherLimitSeparator = new RegExp(
    `\\s*[/／|｜]\\s*(?=${otherLabel.source})`,
    "i",
  );
  const candidates = findAll(root, (node) => {
    const text = trimmedText(node);
    return text.length < 180 && label.test(text);
  });
  for (const node of candidates) {
    const text = trimmedText(node);
    const match = text.match(label);
    const matchedLabel = match?.[0];
    const matchIndex = match?.index;
    if (matchIndex === undefined || !matchedLabel) continue;
    const value = text
      .slice(matchIndex + matchedLabel.length)
      .split(otherLimitSeparator, 1)[0]
      ?.trim();
    const normalizedValue = value?.replace(otherLabel, "").trim();
    if (normalizedValue) return normalizedValue;
  }
  return undefined;
}

function atcoderTimeText(
  statement: HtmlElementNode,
  root: HtmlRootNode,
): string | undefined {
  return (
    textFromClass(statement, ["time-limit"]) ??
    japaneseLimitText(statement, "time") ??
    timeText(statement) ??
    timeText(root) ??
    japaneseLimitText(root, "time")
  );
}

function atcoderMemoryText(
  statement: HtmlElementNode,
  root: HtmlRootNode,
): string | undefined {
  return (
    textFromClass(statement, ["memory-limit"]) ??
    japaneseLimitText(statement, "memory") ??
    memoryText(statement) ??
    memoryText(root) ??
    japaneseLimitText(root, "memory")
  );
}

function atcoderTitle(
  root: HtmlRootNode,
  fallback?: string,
): string | undefined {
  const heading = findFirst(root, (node) => hasClass(node, "h2"));
  if (heading) {
    // The editorial link is a sibling of the title text inside the `.h2`
    // wrapper. Keep direct text nodes and omit navigation links.
    const directText = heading.children
      .filter((child) => child.type === "text")
      .map((child) => child.value)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (directText) return directText;
  }
  return fallback?.trim() || undefined;
}

function isHidden(node: HtmlElementNode): boolean {
  return (
    /display\s*:\s*none/i.test(attr(node, "style") ?? "") ||
    hasClass(node, "d-none") ||
    hasClass(node, "hidden")
  );
}

function inlineDisplay(node: HtmlElementNode): string | undefined {
  const match = (attr(node, "style") ?? "").match(/display\s*:\s*([^;]+)/i);
  return match?.[1]?.trim().toLowerCase();
}

function isLanguageSpan(node: HtmlElementNode): boolean {
  return hasClass(node, "lang-en") || hasClass(node, "lang-ja");
}

function variantLanguage(node: HtmlElementNode): "en" | "ja" | undefined {
  if (hasClass(node, "lang-ja")) return "ja";
  if (hasClass(node, "lang-en")) return "en";
  return undefined;
}

function displayedLanguage(
  statement: HtmlElementNode,
): "en" | "ja" | undefined {
  const variants = findAll(statement, isLanguageSpan);
  if (variants.length === 0) return undefined;
  const only = variants[0];
  if (variants.length === 1 && only) return variantLanguage(only);
  const shown = variants.filter((node) => {
    const display = inlineDisplay(node);
    return Boolean(display) && display !== "none";
  });
  const shownLanguage = shown[0] ? variantLanguage(shown[0]) : undefined;
  if (shown.length === 1 && shownLanguage) return shownLanguage;
  const hidden = variants.filter((node) => isHidden(node));
  const visible = variants.filter((node) => !isHidden(node));
  const visibleLanguage = visible[0] ? variantLanguage(visible[0]) : undefined;
  if (hidden.length > 0 && visible.length === 1 && visibleLanguage)
    return visibleLanguage;
  return undefined;
}

function languageVariant(
  statement: HtmlElementNode,
  language: "en" | "ja" | undefined,
): HtmlElementNode {
  const variants = findAll(statement, isLanguageSpan);
  if (variants.length === 0) return statement;
  const chosen = displayedLanguage(statement) ?? language;
  const preferred = chosen
    ? variants.find((node) => hasClass(node, `lang-${chosen}`))
    : undefined;
  if (preferred) return preferred;
  const visible = variants.find((node) => !isHidden(node));
  return visible ?? variants[0] ?? statement;
}

const SCORE_LINE =
  /^(?:配点|score)\s*[:：]\s*\d[\d,\s]*\s*(?:点|points?)\s*\.?\s*$/i;

function stripContestScore(root: HtmlElementNode): void {
  removeNodes(root, (node) => {
    if (node.tagName !== "p") return false;
    const text = trimmedText(node).replace(/\s+/g, " ");
    return text.length <= 120 && SCORE_LINE.test(text);
  });
}

function stripSectionRules(root: HtmlElementNode): void {
  removeNodes(root, (node) => node.tagName === "hr");
}

function selectedLanguage(
  url: string,
  statement: HtmlElementNode,
  snapshotLanguage?: ProblemLanguage,
): "en" | "ja" | undefined {
  const displayed = displayedLanguage(statement);
  if (displayed) return displayed;
  const fromUrl = languageFromUrl(url);
  if (fromUrl) return fromUrl;
  const normalized =
    normalizeProblemLanguage(attr(statement, "lang")) ??
    snapshotLanguage ??
    "en";
  return normalized === "ja" ? "ja" : "en";
}

export const atcoderProblemAdapter: ProblemAdapter = {
  oj: "atcoder",
  match(url) {
    try {
      const parsed = new URL(url);
      return (
        /(^|\.)atcoder\.jp$/i.test(parsed.hostname) &&
        URL_PATTERNS.some((pattern) => pattern.test(parsed.pathname))
      );
    } catch {
      return false;
    }
  },
  async inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined> {
    if (!this.match(probe.url)) return undefined;
    const root = parseProbe(probe);
    const statement = findRoot(root, {
      ids: ["task-statement"],
      classes: ["task-statement"],
    });
    if (!statement) return undefined;
    const language = selectedLanguage(probe.url, statement);
    return preview(
      "atcoder",
      probe,
      idFromUrl(probe.url, URL_PATTERNS),
      atcoderTitle(root, probe.title),
      language,
    );
  },
  async extract(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult> {
    if (!this.match(snapshot.url))
      return { ok: false, reason: "unsupported-url" };
    const root = parseSnapshot(snapshot);
    const statement = findRoot(root, {
      ids: ["task-statement"],
      classes: ["task-statement"],
    });
    if (!statement) return { ok: false, reason: "statement-not-found" };
    const language = selectedLanguage(
      snapshot.url,
      statement,
      snapshot.language,
    );
    const selectedStatement = languageVariant(statement, language);
    stripContestScore(selectedStatement);
    stripSectionRules(selectedStatement);
    return extractDocument({
      source: "atcoder",
      snapshot,
      problemId: idFromUrl(snapshot.url, URL_PATTERNS),
      title: atcoderTitle(root, snapshot.title),
      root: selectedStatement,
      language,
      timeText: atcoderTimeText(selectedStatement, root),
      memoryText: atcoderMemoryText(selectedStatement, root),
    });
  },
};
