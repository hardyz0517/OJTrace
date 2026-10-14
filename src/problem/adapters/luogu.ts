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
  memoryText,
  parseProbe,
  parseSnapshot,
  preview,
  textFromClass,
  timeText,
} from "./common";
import {
  findAll,
  findFirst,
  hasClass,
  parseHtmlDocument,
  trimmedText,
  type HtmlElementNode,
} from "../extract/html-document";
import { cleanTitle } from "../extract/metadata";
import { markdownToHtml } from "../extract/markdown-to-html";

const URL_PATTERNS = [
  /\/problem\/(?:show\?pid=)?([PpBbUuTt]\d+)/i,
  /[?&]pid=([PpBbUuTt]\d+)/i,
];

const LUOGU_SECTION_TITLES = new Set([
  "题目背景",
  "题目描述",
  "输入格式",
  "输出格式",
  "输入输出样例",
  "说明/提示",
  "说明",
  "提示",
  "数据规模与约定",
]);

function looksLikeHandle(value: string): boolean {
  return /^[A-Za-z0-9_-]{2,32}$/.test(value.trim());
}

function stripProblemId(value: string, problemId?: string): string {
  const source = value.replace(/\s+/g, " ").trim();
  const stripped = problemId
    ? source.replace(
        new RegExp(
          `^${problemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`,
          "i",
        ),
        "",
      )
    : source.replace(/^[PBUT]\d+\s+/i, "");
  const cleaned = stripped.trim();
  return cleaned || source;
}

function luoguTitle(
  root: ReturnType<typeof parseProbe>,
  pageUrl: string,
  fallback: string,
): string {
  const problemId = idFromUrl(pageUrl, URL_PATTERNS);
  const normalizedId = problemId?.toUpperCase();
  const headings = findAll(root, (node) => /^h[1-3]$/.test(node.tagName))
    .map((node) => trimmedText(node).replace(/\s+/g, " ").trim())
    .filter((text) => text && !LUOGU_SECTION_TITLES.has(text));
  const withId = normalizedId
    ? headings.find((text) => text.toUpperCase().includes(normalizedId))
    : undefined;
  if (withId) return stripProblemId(withId, problemId);
  const documentTitle = cleanTitle(fallback) ?? "";
  if (normalizedId && documentTitle.toUpperCase().includes(normalizedId))
    return stripProblemId(documentTitle, problemId);
  const readable = headings.find((text) => !looksLikeHandle(text));
  if (readable) return stripProblemId(readable, problemId);
  if (documentTitle && !looksLikeHandle(documentTitle))
    return stripProblemId(documentTitle, problemId);
  return "";
}

function luoguBody(statement: HtmlElementNode): HtmlElementNode {
  const children = statement.children.filter(
    (child) =>
      !(
        child.type === "element" &&
        (child.tagName === "h1" || hasClass(child, "problem-block-actions"))
      ),
  );
  return children.length === statement.children.length
    ? statement
    : { ...statement, children };
}

function luoguRoot(root: ReturnType<typeof parseProbe>) {
  return (
    findRoot(root, {
      classes: [
        "problem",
        "problem-content",
        "lg-article",
        "markdown-body",
        "problem-statement",
      ],
      ids: ["problem-content"],
    }) ??
    findFirst(
      root,
      (node) => node.tagName === "main" || node.tagName === "article",
    )
  );
}

const LUOGU_CONTENT_FIELDS = [
  "pid",
  "name",
  "title",
  "content",
  "contenu",
  "background",
  "description",
  "formatI",
  "formatO",
  "inputFormat",
  "outputFormat",
  "hint",
  "samples",
  "limits",
  "timeLimit",
  "memoryLimit",
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  source: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = Array.isArray(value) ? value[0] : value;
  return typeof numeric === "number" && Number.isFinite(numeric) && numeric > 0
    ? numeric
    : undefined;
}

function statementScore(problem: Record<string, unknown>): number {
  const nested = record(problem.content) ?? record(problem.contenu);
  const content = nested ?? problem;
  return [
    "background",
    "description",
    "formatI",
    "formatO",
    "inputFormat",
    "outputFormat",
    "hint",
  ].reduce((score, key) => {
    const value = content[key];
    return score + (typeof value === "string" ? value.trim().length : 0);
  }, 0);
}

function luoguProblemRecord(
  snapshot: ProblemPageSnapshot,
): Record<string, unknown> | undefined {
  const urlId = idFromUrl(snapshot.url, URL_PATTERNS)?.toUpperCase();
  const problems = ["luoguProblem", "luoguProblemCurrent"].flatMap((key) => {
    const problem = record(snapshot.sourceData?.[key]);
    if (!problem) return [];
    const pid =
      typeof problem.pid === "string" ? problem.pid.toUpperCase() : undefined;
    return !pid || !urlId || pid === urlId ? [problem] : [];
  });
  return problems.sort(
    (left, right) => statementScore(right) - statementScore(left),
  )[0];
}

/** Luogu `limits.time` is milliseconds. Values below 50 are whole seconds. */
function formatLuoguTime(value: number): string {
  const milliseconds = value >= 50 ? value : value * 1000;
  if (milliseconds % 1000 === 0) return `${milliseconds / 1000} s`;
  if (milliseconds > 1000)
    return `${Number((milliseconds / 1000).toFixed(2))} s`;
  return `${milliseconds} ms`;
}

/**
 * Luogu `limits.memory` is KiB. A smaller number is MB, and a very large
 * number is bytes. The PDF shows the same MB unit as the Luogu page.
 */
function formatLuoguMemory(value: number): string {
  const kibibytes =
    value >= 8_388_608 ? value / 1024 : value >= 8192 ? value : value * 1024;
  if (kibibytes % 1024 === 0) return `${kibibytes / 1024} MB`;
  return `${Number((kibibytes / 1024).toFixed(2))} MB`;
}

function luoguStructuredRoot(snapshot: ProblemPageSnapshot):
  | {
      root: HtmlElementNode;
      title?: string;
      timeText?: string;
      memoryText?: string;
    }
  | undefined {
  const problem = luoguProblemRecord(snapshot);
  if (!problem) return undefined;
  const nested = record(problem.content) ?? record(problem.contenu);
  const content = nested ?? problem;
  const sectionFields: readonly [string, string | undefined][] = [
    ["题目背景", stringField(content, ["background"])],
    ["题目描述", stringField(content, ["description"])],
    ["输入格式", stringField(content, ["formatI", "inputFormat"])],
    ["输出格式", stringField(content, ["formatO", "outputFormat"])],
    ["说明/提示", stringField(content, ["hint"])],
  ];
  const sections = sectionFields.flatMap(([heading, value]) => {
    if (!value) return [];
    const visible = stripLuoguAntiAi(value).trim();
    return visible ? [[heading, visible] as [string, string]] : [];
  });
  const parts: string[] = [];
  let hintIndex = -1;
  for (const [heading, markdown] of sections) {
    if (heading === "说明/提示") hintIndex = parts.length;
    const rendered = markdownToHtml(markdown);
    parts.push(`<h2>${heading}</h2>`, rendered);
  }

  const samples = Array.isArray(problem.samples)
    ? problem.samples
    : Array.isArray(content.samples)
      ? content.samples
      : [];
  const renderedSamples = samples.flatMap((sample, index) => {
    if (!Array.isArray(sample) || sample.length < 2) return [];
    const input = sample[0];
    const output = sample[1];
    if (typeof input !== "string" || typeof output !== "string") return [];
    const sampleNumber = index + 1;
    return [
      `<h3>输入 #${sampleNumber}</h3><pre>${escapePre(input)}</pre>`,
      `<h3>输出 #${sampleNumber}</h3><pre>${escapePre(output)}</pre>`,
    ];
  });
  if (renderedSamples.length)
    parts.splice(
      hintIndex >= 0 ? hintIndex : parts.length,
      0,
      ...renderedSamples,
    );

  if (!parts.length) return undefined;
  const parsed = parseHtmlDocument(`<div>${parts.join("")}</div>`);
  const root = findFirst(parsed, (node) => node.tagName === "div");
  if (!root) return undefined;

  const limits = record(problem.limits) ?? record(content.limits);
  const time =
    positiveNumber(limits?.time) ??
    positiveNumber(problem.timeLimit) ??
    positiveNumber(content.timeLimit);
  const memory =
    positiveNumber(limits?.memory) ??
    positiveNumber(problem.memoryLimit) ??
    positiveNumber(content.memoryLimit);
  const name =
    stringField(nested, ["name", "title"]) ??
    stringField(problem, ["title", "name"]);
  const problemId = idFromUrl(snapshot.url, URL_PATTERNS);
  return {
    root,
    ...(name ? { title: stripProblemId(name, problemId) } : {}),
    ...(time ? { timeText: formatLuoguTime(time) } : {}),
    ...(memory ? { memoryText: formatLuoguMemory(memory) } : {}),
  };
}

function stripLuoguAntiAi(markdown: string): string {
  return markdown
    .replace(/::anti-ai\\\[[\s\S]*?\\\]/g, "")
    .replace(/::anti-ai\[[\s\S]*?\]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function escapePre(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const luoguProblemAdapter: ProblemAdapter = {
  oj: "luogu",
  captureHints: {
    jsonScripts: [
      {
        selector: "#lentille-context",
        key: "luoguProblem",
        path: ["data", "problem"],
        fields: LUOGU_CONTENT_FIELDS,
      },
      {
        selector: "#lentille-context",
        key: "luoguProblemCurrent",
        path: ["currentData", "problem"],
        fields: LUOGU_CONTENT_FIELDS,
      },
    ],
  },
  match(url) {
    try {
      const parsed = new URL(url);
      return (
        /(^|\.)luogu\.com\.cn$/i.test(parsed.hostname) &&
        URL_PATTERNS.some((pattern) =>
          pattern.test(`${parsed.pathname}${parsed.search}`),
        )
      );
    } catch {
      return false;
    }
  },
  async inspect(probe: ProblemPageProbe): Promise<ProblemPreview | undefined> {
    if (!this.match(probe.url)) return undefined;
    const parsed = parseProbe(probe);
    const statement = luoguRoot(parsed);
    if (!statement) return undefined;
    if (
      /登录|login|加载中|loading/i.test(trimmedText(statement)) &&
      trimmedText(statement).length < 300
    )
      return undefined;
    return preview(
      "luogu",
      probe,
      idFromUrl(`${probe.url}`, URL_PATTERNS),
      luoguTitle(parsed, probe.url, probe.title),
      "zh",
    );
  },
  async extract(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult> {
    if (!this.match(snapshot.url))
      return { ok: false, reason: "unsupported-url" };
    const parsed = parseSnapshot(snapshot);
    const structured = luoguStructuredRoot(snapshot);
    if (structured)
      return extractDocument({
        source: "luogu",
        snapshot,
        problemId: idFromUrl(snapshot.url, URL_PATTERNS),
        title:
          structured.title ?? luoguTitle(parsed, snapshot.url, snapshot.title),
        root: structured.root,
        language: "zh",
        timeText: structured.timeText,
        memoryText: structured.memoryText,
      });
    const statement = luoguRoot(parsed);
    if (!statement) return { ok: false, reason: "statement-not-found" };
    const text = trimmedText(statement);
    if (/登录|login required|请先登录/i.test(text) && text.length < 500)
      return { ok: false, reason: "login-required" };
    return extractDocument({
      source: "luogu",
      snapshot,
      problemId: idFromUrl(snapshot.url, URL_PATTERNS),
      title: luoguTitle(parsed, snapshot.url, snapshot.title),
      root: luoguBody(statement),
      language: "zh",
      timeText:
        textFromClass(statement, ["time-limit", "problem-info"]) ??
        timeText(parsed),
      memoryText:
        textFromClass(statement, ["memory-limit", "problem-info"]) ??
        memoryText(parsed),
    });
  },
};
