import { Marked } from "marked";
import type { ProblemAdapter } from "../adapter";
import type {
  ProblemExtractionResult,
  ProblemPageProbe,
  ProblemPageSnapshot,
  ProblemPreview,
} from "../domain";
import {
  extractSourceDocument,
  findRoot,
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
  removeNodes,
  serializeNode,
  trimmedText,
  type HtmlElementNode,
} from "../extract/html-document";
import { htmlToAst } from "../markdown/html";
import type { MarkdownBlock } from "../markdown/ast";
import { serializeMarkdown } from "../markdown/serialize";
import { parseMarkdown } from "../markdown/parse";
import { inlineText } from "../markdown/text";
import { cleanTitle } from "../extract/metadata";
import { inferProblemLanguage, normalizeProblemLanguage } from "../language";

/** Problem-bank prefixes are extensible; the problem route owns recognition. */
function luoguProblemId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (
      !/^https?:$/.test(parsed.protocol) ||
      !/(^|\.)luogu\.com\.cn$/i.test(parsed.hostname)
    )
      return undefined;
    let id: string | undefined;
    if (/^\/problem\/show\/?$/i.test(parsed.pathname)) {
      const ids = parsed.searchParams.getAll("pid");
      if (ids.length !== 1) return undefined;
      id = ids[0];
    } else {
      const segment = parsed.pathname.match(/^\/problem\/([^/]+)\/?$/i)?.[1];
      if (segment) id = decodeURIComponent(segment);
    }
    // Digits distinguish problem ids from routes such as list, new and show.
    return id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) && /\d/.test(id)
      ? id
      : undefined;
  } catch {
    return undefined;
  }
}

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
    : source;
  const cleaned = stripped.trim();
  return cleaned || source;
}

function luoguTitle(
  root: ReturnType<typeof parseProbe>,
  pageUrl: string,
  fallback: string,
): string {
  const problemId = luoguProblemId(pageUrl);
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
  removeNodes(statement, (node) => {
    if (hasClass(node, "problem-block-actions")) return true;
    if (
      node.tagName !== "button" ||
      !/^(?:复制(?:输入|输出|样例)?|copy(?: input| output| example)?)$/i.test(
        trimmedText(node) || node.attrs["aria-label"] || node.attrs.title || "",
      )
    )
      return false;
    let parent = node.parent;
    while (parent && parent !== statement) {
      if (hasClass(parent, "io-sample-block")) return true;
      parent = parent.parent;
    }
    return false;
  });
  // These are UI subheadings even when Luogu renders them as bold paragraphs.
  const sampleHeading = findFirst(
    statement,
    (node) =>
      /^h[1-6]$/.test(node.tagName) && trimmedText(node) === "输入输出样例",
  );
  if (sampleHeading) {
    const level = Math.min(6, Number(sampleHeading.tagName.slice(1)) + 1);
    for (const part of findAll(statement, (node) =>
      hasClass(node, "io-sample-block"),
    )) {
      const label = part.children.find(
        (node) =>
          node.type === "element" && /^(?:p|h[1-6])$/.test(node.tagName),
      );
      if (label?.type === "element" && label.tagName === "p")
        label.tagName = `h${level}`;
    }
  }
  return statement;
}

function luoguDisplayedSamples(
  parsed: ReturnType<typeof parseSnapshot>,
  snapshot: ProblemPageSnapshot,
) {
  const statement = luoguRoot(parsed);
  if (!statement) return undefined;
  const body = luoguBody(statement);
  const heading = findFirst(
    body,
    (node) =>
      /^h[1-6]$/.test(node.tagName) && trimmedText(node) === "输入输出样例",
  );
  if (!heading) return undefined;
  return findAll(body, (node) => hasClass(node, "io-sample")).map(
    (node) => htmlToAst(serializeNode(node), snapshot.baseUrl).blocks,
  );
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

/** Select a complete version once. Empty translated sections are intentional. */
function statementContent(
  problem: Record<string, unknown>,
): Record<string, unknown> {
  return record(problem.contenu) ?? record(problem.content) ?? problem;
}

function statementScore(problem: Record<string, unknown>): number {
  const content = statementContent(problem);
  return [
    "background",
    "description",
    "formatI",
    "formatO",
    "inputFormat",
    "outputFormat",
    "hint",
  ].reduce((score, key) => {
    return score + (stringField(content, [key])?.trim().length ?? 0);
  }, 0);
}

function luoguProblemRecord(
  snapshot: ProblemPageSnapshot,
): Record<string, unknown> | undefined {
  const urlId = luoguProblemId(snapshot.url)?.toUpperCase();
  const problems = ["luoguProblem", "luoguProblemCurrent"].flatMap((key) => {
    const problem = record(snapshot.sourceData?.[key]);
    if (!problem) return [];
    const pid =
      typeof problem.pid === "string" ? problem.pid.toUpperCase() : undefined;
    return !pid || !urlId || pid === urlId ? [problem] : [];
  });
  // A longer original in another payload must not displace a translation.
  return problems.sort(
    (left, right) =>
      Number(!!record(right.contenu)) - Number(!!record(left.contenu)) ||
      statementScore(right) - statementScore(left),
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

// Labels of the native JSON fields as displayed by the source statement UI.
// They establish source boundaries, not CNOI normalization or sample numbering.
const LUOGU_SOURCE_LABELS = {
  zh: {
    background: "题目背景",
    description: "题目描述",
    formatI: "输入格式",
    formatO: "输出格式",
    hint: "说明/提示",
    samples: "输入输出样例",
    input: "输入",
    output: "输出",
  },
  en: {
    background: "Background",
    description: "Problem Statement",
    formatI: "Input",
    formatO: "Output",
    hint: "Notes",
    samples: "Samples",
    input: "Input",
    output: "Output",
  },
  ja: {
    background: "背景",
    description: "問題文",
    formatI: "入力",
    formatO: "出力",
    hint: "解説",
    samples: "入出力例",
    input: "入力",
    output: "出力",
  },
} as const;

function luoguNativeSource(
  snapshot: ProblemPageSnapshot,
  parsed: ReturnType<typeof parseSnapshot>,
) {
  const problem = luoguProblemRecord(snapshot);
  if (!problem) return undefined;
  const content = statementContent(problem);
  const fields = [
    "background",
    "description",
    "formatI",
    "inputFormat",
    "formatO",
    "outputFormat",
    "hint",
  ] as const;
  const values = new Map<string, string>();
  for (const key of fields) {
    if (key === "inputFormat" && stringField(content, ["formatI"])) continue;
    if (key === "outputFormat" && stringField(content, ["formatO"])) continue;
    const value = stringField(content, [key]);
    if (value) values.set(key, stripLuoguAntiAi(value));
  }
  const language =
    normalizeProblemLanguage(stringField(content, ["locale"])) ??
    inferProblemLanguage([...values.values()].join("\n")) ??
    "other";
  const labels = LUOGU_SOURCE_LABELS[language === "other" ? "en" : language];
  const heading = (title: string, level: number) => ({
    type: "heading" as const,
    level,
    children: [{ type: "text" as const, value: title }],
  });
  const sourceParts: string[] = [];
  const addField = (key: string) => {
    const value = values.get(key);
    if (!value) return;
    const field =
      key === "inputFormat"
        ? "formatI"
        : key === "outputFormat"
          ? "formatO"
          : key;
    const title =
      language === "other" ? key : labels[field as keyof typeof labels];
    let already = false;
    try {
      const first = parseMarkdown(value).ast.children[0];
      already =
        first?.type === "heading" &&
        first.level === 2 &&
        inlineText(first.children).trim() === title;
    } catch {
      /* Native text remains copyable even when syntax is incomplete. */
    }
    sourceParts.push(already ? value : `## ${title}\n\n${value}`);
  };
  for (const key of fields) if (key !== "hint") addField(key);
  const samples = Array.isArray(problem.samples)
    ? problem.samples
    : Array.isArray(content.samples)
      ? content.samples
      : [];
  const presentation =
    language === "zh" ? luoguDisplayedSamples(parsed, snapshot) : undefined;
  const usedPresentation = new Set<readonly MarkdownBlock[]>();
  const sameCode = (left: string, right: string) =>
    left.replace(/\r\n/g, "\n").replace(/\n$/, "") ===
    right.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const items = samples.flatMap((sample, index) => {
    if (
      !Array.isArray(sample) ||
      typeof sample[0] !== "string" ||
      typeof sample[1] !== "string"
    )
      return [];
    const displayed = presentation?.find((nodes) => {
      const code = nodes.filter((node) => node.type === "code");
      return (
        !usedPresentation.has(nodes) &&
        code[0] &&
        code[1] &&
        sameCode(code[0].value, sample[0]) &&
        sameCode(code[1].value, sample[1])
      );
    });
    if (displayed) usedPresentation.add(displayed);
    // The native export has a separate numbered section for each sample pair.
    // Read DOM identifiers only; presentation markup such as <b> is page UI.
    const identifiers = displayed
      ?.filter((node) => node.type === "heading")
      .map((node) => inlineText(node.children).match(/\s+(#\s*\S+)\s*$/u)?.[1]);
    const identifier = identifiers?.[0] ?? identifiers?.[1] ?? `#${index + 1}`;
    const nodes: MarkdownBlock[] = [
      heading(`${labels.samples} ${identifier}`, 2),
    ];
    for (const [at, data] of [sample[0], sample[1]].entries()) {
      const title = `${at === 0 ? labels.input : labels.output} ${identifiers?.[at] ?? identifier}`;
      nodes.push(heading(title, 3), { type: "code", value: data });
    }
    return [serializeMarkdown(nodes).trimEnd()];
  });
  sourceParts.push(...items);
  addField("hint");
  if (!sourceParts.length) return undefined;
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
    stringField(content, ["name", "title"]) ??
    stringField(problem, ["name", "title"]);
  const problemId = luoguProblemId(snapshot.url);
  const title = name
    ? stripProblemId(name, problemId)
    : luoguTitle(parsed, snapshot.url, snapshot.title);

  return {
    sourceMarkdown: `# ${problemId} ${title}\n\n${sourceParts.join("\n\n")}\n`,
    title,
    ...(time ? { timeText: formatLuoguTime(time) } : {}),
    ...(memory ? { memoryText: formatLuoguMemory(memory) } : {}),
    language,
  };
}

function stripLuoguAntiAi(markdown: string): string {
  if (!markdown.includes("::anti-ai")) return markdown;
  // Preserve code and ambiguous nested syntax. Only remove page-invisible prose directives.
  const lexer = new Marked({ gfm: true });
  const normalized = markdown.replace(/\r\n?|\n/g, "\n");
  const protectedRanges: [number, number][] = [];
  let cursor = 0;
  for (const token of lexer.lexer(normalized)) {
    const at = normalized.indexOf(token.raw, cursor);
    if (at < 0) return markdown;
    if (["code", "html", "list", "blockquote"].includes(token.type))
      protectedRanges.push([at, at + token.raw.length]);
    else {
      let inlineAt = at;
      for (const inline of lexer.Lexer.lexInline(token.raw)) {
        const next = normalized.indexOf(inline.raw, inlineAt);
        if (next < 0) return markdown;
        if (inline.type === "codespan" || inline.type === "html")
          protectedRanges.push([next, next + inline.raw.length]);
        inlineAt = next + inline.raw.length;
      }
    }
    cursor = at + token.raw.length;
  }
  const carriageReturns = [...markdown.matchAll(/\r\n/g)].map(
    (match) => match.index,
  );
  const normalizedIndex = (offset: number) => {
    let lower = 0,
      upper = carriageReturns.length;
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      if (carriageReturns[middle]! < offset) lower = middle + 1;
      else upper = middle;
    }
    return offset - lower;
  };
  return markdown.replace(
    /::anti-ai\\?\[[\s\S]*?\\?\]/g,
    (match: string, offset: number) => {
      const at = normalizedIndex(offset);
      return protectedRanges.some(([from, to]) => at >= from && at < to)
        ? match
        : "";
    },
  );
}

export const luoguProblemAdapter: ProblemAdapter = {
  oj: "luogu",
  captureHints(url) {
    const identity = {
      field: "pid",
      value: luoguProblemId(url)?.toUpperCase() ?? "",
    };
    return {
      jsonScripts: [
        {
          selector: "#lentille-context",
          key: "luoguProblem",
          path: ["data", "problem"],
          fields: LUOGU_CONTENT_FIELDS,
          identity,
        },
        {
          selector: "#lentille-context",
          key: "luoguProblemCurrent",
          path: ["currentData", "problem"],
          fields: LUOGU_CONTENT_FIELDS,
          identity,
        },
      ],
      jsonRequest: {
        key: "luoguProblem",
        path: ["data", "problem"],
        fields: LUOGU_CONTENT_FIELDS,
        identity,
        headers: { "x-lentille-request": "content-only" },
      },
    };
  },
  match(url) {
    return luoguProblemId(url) !== undefined;
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
      luoguProblemId(probe.url),
      luoguTitle(parsed, probe.url, probe.title),
      "zh",
    );
  },
  async extractSource(
    snapshot: ProblemPageSnapshot,
  ): Promise<ProblemExtractionResult> {
    if (!this.match(snapshot.url))
      return { ok: false, reason: "unsupported-url" };
    const parsed = parseSnapshot(snapshot);
    const native = luoguNativeSource(snapshot, parsed);
    if (native)
      return extractSourceDocument({
        source: "luogu",
        snapshot,
        problemId: luoguProblemId(snapshot.url),
        title: native.title ?? luoguTitle(parsed, snapshot.url, snapshot.title),
        sourceMarkdown: native.sourceMarkdown,
        language: native.language,
        timeText: native.timeText,
        memoryText: native.memoryText,
      });
    const statement = luoguRoot(parsed);
    if (!statement) return { ok: false, reason: "statement-not-found" };
    const text = trimmedText(statement);
    if (/登录|login required|请先登录/i.test(text) && text.length < 500)
      return { ok: false, reason: "login-required" };
    return extractSourceDocument({
      source: "luogu",
      snapshot,
      problemId: luoguProblemId(snapshot.url),
      title: luoguTitle(parsed, snapshot.url, snapshot.title),
      root: luoguBody(statement),
      language:
        inferProblemLanguage(trimmedText(statement)) ??
        snapshot.language ??
        "other",
      timeText:
        textFromClass(statement, ["time-limit", "problem-info"]) ??
        timeText(parsed),
      memoryText:
        textFromClass(statement, ["memory-limit", "problem-info"]) ??
        memoryText(parsed),
    });
  },
};
