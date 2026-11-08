import type {
  CrossOjEvaluationStatus,
  CrossOjSubmissionDetail,
  CrossOjTestCaseDetail,
} from "./model";
import { isCrossOjSubmissionDetail } from "./model";
import { canonicalCrossOjDetailUrl } from "./history";
import { classifyEvaluationText } from "./evaluation";
import {
  codeforcesSubmissionFromUrl,
  parseCodeforcesProblemUrl,
} from "./problem";
import { atcoderSubmissionFromUrl } from "./atcoder";

const MAX_TESTS = 200;
const MAX_SOURCE_CHARS = 120_000;
const MAX_FIELD_CHARS = 20_000;
const MAX_DETAIL_TEXT_CHARS = 180_000;

function textOf(element: Element | null | undefined): string {
  if (!element) return "";
  const html = element as HTMLElement;
  return (html.innerText || element.textContent || "").trim();
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function safeCodeforcesLink(
  raw: string | null | undefined,
): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw, "https://codeforces.com");
    if (url.origin !== "https://codeforces.com" || url.username || url.password)
      return undefined;
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function parseNumberWithUnit(
  value: string,
  unit: "time" | "memory",
): number | undefined {
  const expression =
    unit === "time"
      ? /(\d+(?:\.\d+)?)\s*(ms|s)\b/i
      : /(\d+(?:\.\d+)?)\s*(bytes?|b|kb|kib|mb|mib)\b/i;
  const match = expression.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const suffix = match[2]!.toLowerCase();
  const result =
    unit === "time"
      ? amount * (suffix === "s" ? 1000 : 1)
      : amount *
        (suffix === "mb" || suffix === "mib"
          ? 1024 * 1024
          : suffix === "kb" || suffix === "kib"
            ? 1024
            : 1);
  return Number.isSafeInteger(Math.round(result))
    ? Math.round(result)
    : undefined;
}

interface SubmissionRow {
  cells: HTMLTableCellElement[];
  valuesByHeader: Map<string, string>;
}

function submissionRow(
  doc: Document,
  submissionId: string,
): SubmissionRow | undefined {
  for (const table of doc.querySelectorAll("table")) {
    const rows = Array.from(table.rows);
    const header = rows.find((row) => {
      const values = Array.from(row.cells).map((cell) =>
        normalized(textOf(cell)),
      );
      return (
        values.includes("problem") &&
        values.includes("verdict") &&
        values.includes("time") &&
        values.includes("memory")
      );
    });
    if (!header) continue;
    const headers = Array.from(header.cells).map((cell) =>
      normalized(textOf(cell)),
    );
    const row = rows.find((candidate) => {
      if (candidate === header) return false;
      const firstCell = textOf(candidate.cells[0]);
      const hasSubmissionLink = Array.from(
        candidate.querySelectorAll("a[href]"),
      ).some(
        (link) =>
          safeCodeforcesLink(link.getAttribute("href"))?.match(
            /\/submission\/(\d+)\/?$/,
          )?.[1] === submissionId,
      );
      return firstCell === submissionId || hasSubmissionLink;
    });
    if (!row) continue;
    const cells = Array.from(row.cells);
    const valuesByHeader = new Map<string, string>();
    headers.forEach((name, index) => {
      const cell = cells[index];
      if (cell) valuesByHeader.set(name, textOf(cell));
    });
    return { cells, valuesByHeader };
  }
  return undefined;
}

function extractSourceCode(doc: Document): string | undefined {
  const selectors = [
    "#program-source-text",
    "pre.program-source",
    ".program-source pre",
    "pre.prettyprint",
  ];
  for (const selector of selectors) {
    const value = textOf(doc.querySelector(selector));
    if (value) return value;
  }
  const sourceHeading = Array.from(
    doc.querySelectorAll<HTMLElement>("h1,h2,h3,h4,strong,b,span,div"),
  ).find((element) => {
    if (element.children.length > 2) return false;
    return /^→?\s*source$/i.test(textOf(element));
  });
  let ancestor: Element | null = sourceHeading ?? null;
  for (let depth = 0; ancestor && depth < 5; depth += 1) {
    const pre = ancestor.querySelector("pre");
    if (pre && textOf(pre)) return textOf(pre);
    ancestor = ancestor.parentElement;
  }
  return undefined;
}

const TEST_FIELDS: Array<{
  key: "input" | "output" | "answer" | "checkerLog";
  label: RegExp;
}> = [
  { key: "input", label: /^input\s*:?$/i },
  {
    key: "output",
    label: /^(?:participant(?:'s)? output|your output|output)\s*:?$/i,
  },
  { key: "answer", label: /^(?:jury(?:'s)? answer|answer)\s*:?$/i },
  {
    key: "checkerLog",
    label: /^(?:checker comment|checker log|checker output)\s*:?$/i,
  },
];

function testHeader(
  lines: string[],
  index: number,
): { number: number; inline: string } | undefined {
  const line = lines[index]!.trim();
  const direct = /^(?:test\s*:?\s*)?#\s*(\d+)\b(.*)$/i.exec(line);
  if (direct) return { number: Number(direct[1]), inline: direct[2] ?? "" };
  const labelled = /^test\s*:?\s*(\d+)\b(.*)$/i.exec(line);
  if (labelled)
    return { number: Number(labelled[1]), inline: labelled[2] ?? "" };
  const standalone = /^(?:#\s*)?(\d{1,3})$/.exec(line);
  if (
    standalone &&
    (index + 1 >= lines.length ||
      /^(?:time|memory|verdict)\s*:/i.test(lines[index + 1]!.trim()))
  )
    return { number: Number(standalone[1]), inline: "" };
  return undefined;
}

function parseTests(protocolText: string): {
  tests: CrossOjTestCaseDetail[];
  truncated: boolean;
} {
  const lines = protocolText.replace(/\r/g, "").split("\n");
  const starts: Array<{ index: number; number: number; inline: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = testHeader(lines, index);
    if (header && header.number > 0) starts.push({ index, ...header });
  }
  const tests: CrossOjTestCaseDetail[] = [];
  for (
    let testIndex = 0;
    testIndex < starts.length && testIndex < MAX_TESTS;
    testIndex += 1
  ) {
    const start = starts[testIndex]!;
    const end = starts[testIndex + 1]?.index ?? lines.length;
    const body = [start.inline, ...lines.slice(start.index + 1, end)]
      .join("\n")
      .trim();
    const timeText =
      /(?:^|[,\s])time\s*:\s*([^,\n]+)/i.exec(body)?.[1] ??
      /(?:^|\n)time\s*:\s*([^,\n]+)/i.exec(body)?.[1];
    const memoryText =
      /(?:^|[,\s])memory\s*:\s*([^,\n]+)/i.exec(body)?.[1] ??
      /(?:^|\n)memory\s*:\s*([^,\n]+)/i.exec(body)?.[1];
    const verdictText =
      /(?:^|\n)verdict\s*:\s*([^\n,]+)/i.exec(body)?.[1] ??
      /(?:^|[,\s])verdict\s*:\s*([^\n,]+)/i.exec(body)?.[1];
    const exitCode = /exit\s*code\s*:\s*(-?\d+)/i.exec(body)?.[1];
    const checkerExitCode = /checker\s+exit\s*code\s*:\s*(-?\d+)/i.exec(
      body,
    )?.[1];
    const test: CrossOjTestCaseDetail = {
      index: start.number,
      ...(verdictText ? { verdict: verdictText.trim() } : {}),
      ...(timeText && parseNumberWithUnit(timeText, "time") !== undefined
        ? { timeMs: parseNumberWithUnit(timeText, "time") }
        : {}),
      ...(memoryText && parseNumberWithUnit(memoryText, "memory") !== undefined
        ? { memoryBytes: parseNumberWithUnit(memoryText, "memory") }
        : {}),
      ...(exitCode !== undefined ? { exitCode: Number(exitCode) } : {}),
      ...(checkerExitCode !== undefined
        ? { checkerExitCode: Number(checkerExitCode) }
        : {}),
    };
    const bodyLines = body.split("\n");
    for (let lineIndex = 0; lineIndex < bodyLines.length; lineIndex += 1) {
      const labelIndex = TEST_FIELDS.findIndex(({ label }) =>
        label.test(bodyLines[lineIndex]!.trim()),
      );
      if (labelIndex < 0) continue;
      const field = TEST_FIELDS[labelIndex]!;
      const valueLines: string[] = [];
      for (
        let valueIndex = lineIndex + 1;
        valueIndex < bodyLines.length;
        valueIndex += 1
      ) {
        const value = bodyLines[valueIndex]!.trim();
        if (
          TEST_FIELDS.some(({ label }) => label.test(value)) ||
          /^(?:time|memory|verdict)\s*:/i.test(value) ||
          /^(?:exit\s*code|checker\s+exit\s*code)\s*:/i.test(value)
        )
          break;
        valueLines.push(bodyLines[valueIndex]!);
      }
      const fieldValue = valueLines.join("\n").trim();
      if (fieldValue) test[field.key] = fieldValue.slice(0, MAX_FIELD_CHARS);
    }
    tests.push(test);
  }
  return { tests, truncated: starts.length > MAX_TESTS };
}

function protocolText(doc: Document): string {
  const visibleText =
    (doc.body as HTMLElement | null)?.innerText || doc.body?.textContent || "";
  const marker = /(?:judgement|judgment|testing)\s+protocol/i.exec(visibleText);
  if (marker) return visibleText.slice(marker.index + marker[0].length);
  // New Codeforces pages label the expander rather than the resulting panel.
  if (/to see test details/i.test(visibleText)) return "";
  return "";
}

function protocolExpander(doc: Document): HTMLElement | undefined {
  return Array.from(doc.querySelectorAll<HTMLElement>("a,button")).find(
    (element) => {
      const label = textOf(element);
      const context = normalized(element.parentElement?.textContent ?? "");
      return (
        /to see test details/i.test(label) ||
        (/to see test details/i.test(context) &&
          /^(?:click|here|view)$/i.test(label))
      );
    },
  );
}

function truncateText(
  sourceCode: string | undefined,
  tests: CrossOjTestCaseDetail[],
): { sourceCode?: string; tests: CrossOjTestCaseDetail[]; truncated: boolean } {
  let remaining = MAX_DETAIL_TEXT_CHARS;
  let truncated = false;
  let nextSource = sourceCode;
  if (nextSource && nextSource.length > MAX_SOURCE_CHARS) {
    nextSource = nextSource.slice(0, MAX_SOURCE_CHARS);
    truncated = true;
  }
  if (nextSource) remaining -= nextSource.length;
  const nextTests = tests.map((test) => ({ ...test }));
  for (const test of nextTests) {
    for (const key of ["input", "output", "answer", "checkerLog"] as const) {
      const value = test[key];
      if (value === undefined) continue;
      const allowed = Math.max(0, Math.min(MAX_FIELD_CHARS, remaining));
      if (value.length > allowed) {
        test[key] = value.slice(0, allowed);
        truncated = true;
      }
      remaining -= test[key]!.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
    }
    if (remaining <= 0) break;
  }
  return {
    ...(nextSource !== undefined ? { sourceCode: nextSource } : {}),
    tests: nextTests,
    truncated,
  };
}

/** Parse only the official Codeforces submission detail document. */
export function parseCodeforcesSubmissionDetail(
  doc: Document,
  rawUrl: string,
  observedAt = Date.now(),
): CrossOjSubmissionDetail | undefined {
  const route = codeforcesSubmissionFromUrl(rawUrl);
  const detailUrl = route
    ? canonicalCrossOjDetailUrl("codeforces", rawUrl, route.submissionId)
    : undefined;
  if (!route || !detailUrl) return undefined;
  const row = submissionRow(doc, route.submissionId);
  if (!row) return undefined;

  const problemLink = row.cells
    .flatMap((cell) =>
      Array.from(cell.querySelectorAll<HTMLAnchorElement>("a[href]")),
    )
    .map((link) => ({
      link,
      url: safeCodeforcesLink(link.getAttribute("href")),
    }))
    .find(({ url }) => url && /\/problem\//.test(url));
  const problemName =
    problemLink?.link.getAttribute("title")?.trim() ||
    textOf(problemLink?.link);
  const problemId = problemLink?.url
    ? (() => {
        const problem = parseCodeforcesProblemUrl(problemLink.url);
        return problem ? `${problem.contestId}/${problem.index}` : "";
      })()
    : "";
  const statusText = row.valuesByHeader.get("verdict") ?? "";
  const evaluationStatus: CrossOjEvaluationStatus =
    classifyEvaluationText(statusText) ?? "unknown";
  const parsedTests = parseTests(protocolText(doc));
  const bounded = truncateText(extractSourceCode(doc), parsedTests.tests);
  const submittedAt = row.valuesByHeader.get("sent");
  const judgedAt = row.valuesByHeader.get("judged");
  const language = row.valuesByHeader.get("lang");
  const timeMs = parseNumberWithUnit(
    row.valuesByHeader.get("time") ?? "",
    "time",
  );
  const memoryBytes = parseNumberWithUnit(
    row.valuesByHeader.get("memory") ?? "",
    "memory",
  );
  const usernameLink = row.cells
    .flatMap((cell) =>
      Array.from(cell.querySelectorAll<HTMLAnchorElement>("a[href]")),
    )
    .find((link) => /^\/profile\/[^/]+\/?$/.test(link.pathname));

  return {
    oj: "codeforces",
    submissionId: route.submissionId,
    problemId,
    detailUrl,
    observedAt,
    evaluationStatus,
    ...(statusText ? { rawVerdict: statusText } : {}),
    ...(usernameLink ? { username: textOf(usernameLink) } : {}),
    ...(problemName ? { problemName } : {}),
    ...(language ? { language } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    ...(judgedAt ? { judgedAt } : {}),
    ...(timeMs !== undefined ? { timeMs } : {}),
    ...(memoryBytes !== undefined ? { memoryBytes } : {}),
    ...(evaluationStatus === "accepted" && parsedTests.tests.length
      ? { passedTestCount: parsedTests.tests.length }
      : {}),
    ...(bounded.sourceCode ? { sourceCode: bounded.sourceCode } : {}),
    tests: bounded.tests,
    truncated: bounded.truncated || parsedTests.truncated,
  };
}

function atcoderMetadata(doc: Document): Map<string, string> {
  const metadata = new Map<string, string>();
  for (const table of doc.querySelectorAll<HTMLTableElement>(
    "table.table-bordered",
  )) {
    for (const row of table.rows) {
      const label = textOf(row.querySelector("th"));
      const value = textOf(row.querySelector("td"));
      if (label && value) metadata.set(normalized(label), value);
    }
  }
  return metadata;
}

function atcoderTestCases(doc: Document): CrossOjTestCaseDetail[] {
  for (const table of doc.querySelectorAll<HTMLTableElement>(
    "table.table-bordered",
  )) {
    const headers = Array.from(
      table.querySelectorAll<HTMLTableCellElement>("thead th, tr th"),
    ).map((cell) => normalized(textOf(cell)));
    const statusIndex = headers.findIndex((header) => header === "status");
    const caseIndex = headers.findIndex((header) =>
      /case name|test case/.test(header),
    );
    if (statusIndex < 0 || caseIndex < 0) continue;
    const timeIndex = headers.findIndex((header) => /time/.test(header));
    const memoryIndex = headers.findIndex((header) => /memory/.test(header));

    return Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"))
      .slice(0, MAX_TESTS)
      .map((row, index) => {
        const cells = Array.from(row.cells);
        const status = textOf(cells[statusIndex]);
        const timeText =
          timeIndex >= 0 && cells[timeIndex] ? textOf(cells[timeIndex]) : "";
        const memoryText =
          memoryIndex >= 0 && cells[memoryIndex]
            ? textOf(cells[memoryIndex])
            : "";
        const timeMs = parseNumberWithUnit(timeText, "time");
        const memoryBytes = parseNumberWithUnit(memoryText, "memory");
        return {
          index: index + 1,
          ...(status ? { verdict: status } : {}),
          ...(timeMs !== undefined ? { timeMs } : {}),
          ...(memoryBytes !== undefined ? { memoryBytes } : {}),
        };
      });
  }
  return [];
}

/** Parse the official AtCoder submission page while it is still open. */
export function parseAtCoderSubmissionDetail(
  doc: Document,
  rawUrl: string,
  observedAt = Date.now(),
): CrossOjSubmissionDetail | undefined {
  const route = atcoderSubmissionFromUrl(rawUrl);
  const detailUrl = route
    ? canonicalCrossOjDetailUrl("atcoder", rawUrl, route.submissionId)
    : undefined;
  if (!route || !detailUrl) return undefined;

  const metadata = atcoderMetadata(doc);
  const taskLink = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>('a[href*="/tasks/"]'),
  ).find((link) => {
    try {
      const url = new URL(
        link.getAttribute("href") ?? link.href,
        "https://atcoder.jp",
      );
      return (
        url.origin === "https://atcoder.jp" &&
        new RegExp(`^/contests/${route.contestId}/tasks/[^/]+$`, "i").test(
          url.pathname,
        )
      );
    } catch {
      return false;
    }
  });
  const taskPath = taskLink
    ? /^\/contests\/[^/]+\/tasks\/([^/]+)$/i.exec(
        new URL(
          taskLink.getAttribute("href") ?? taskLink.href,
          "https://atcoder.jp",
        ).pathname,
      )?.[1]
    : undefined;
  const problemId = taskPath ?? "";
  if (!problemId || !/^[a-z0-9_-]{1,80}$/i.test(problemId)) return undefined;

  const rawVerdict = metadata.get("status");
  const evaluationStatus: CrossOjEvaluationStatus =
    classifyEvaluationText(rawVerdict ?? "") ?? "unknown";
  const parsedTests = atcoderTestCases(doc);
  const sourceCode =
    doc.querySelector("#submission-code")?.textContent ?? undefined;
  const bounded = truncateText(sourceCode?.trimEnd(), parsedTests);
  const timeMs = parseNumberWithUnit(metadata.get("exec time") ?? "", "time");
  const memoryBytes = parseNumberWithUnit(
    metadata.get("memory") ?? "",
    "memory",
  );
  const scoreText = metadata.get("score");
  const scoreValue = scoreText === undefined ? NaN : Number(scoreText);
  const submittedAt = metadata.get("submission time");

  return {
    oj: "atcoder",
    submissionId: route.submissionId,
    problemId,
    detailUrl,
    observedAt,
    evaluationStatus,
    ...(rawVerdict ? { rawVerdict } : {}),
    ...(metadata.get("user") ? { username: metadata.get("user") } : {}),
    ...(textOf(taskLink) ? { problemName: textOf(taskLink) } : {}),
    ...(metadata.get("language") ? { language: metadata.get("language") } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    ...(timeMs !== undefined ? { timeMs } : {}),
    ...(memoryBytes !== undefined ? { memoryBytes } : {}),
    ...(Number.isFinite(scoreValue) ? { score: scoreValue } : {}),
    ...(evaluationStatus === "accepted" && parsedTests.length
      ? {
          passedTestCount: parsedTests.filter((test) => test.verdict === "AC")
            .length,
        }
      : {}),
    ...(bounded.sourceCode !== undefined
      ? { sourceCode: bounded.sourceCode }
      : {}),
    tests: bounded.tests,
    truncated: bounded.truncated,
  };
}

export function readCrossOjSubmissionDetail(
  value: unknown,
): CrossOjSubmissionDetail | undefined {
  if (!isCrossOjSubmissionDetail(value)) return undefined;
  const detailUrl = canonicalCrossOjDetailUrl(
    value.oj,
    value.detailUrl,
    value.submissionId,
  );
  if (!detailUrl) return undefined;
  return {
    oj: value.oj,
    submissionId: value.submissionId,
    problemId: value.problemId,
    detailUrl,
    observedAt: value.observedAt,
    evaluationStatus: value.evaluationStatus,
    ...(value.rawVerdict ? { rawVerdict: value.rawVerdict } : {}),
    ...(value.username ? { username: value.username } : {}),
    ...(value.problemName ? { problemName: value.problemName } : {}),
    ...(value.language ? { language: value.language } : {}),
    ...(value.submittedAt ? { submittedAt: value.submittedAt } : {}),
    ...(value.judgedAt ? { judgedAt: value.judgedAt } : {}),
    ...(value.timeMs !== undefined ? { timeMs: value.timeMs } : {}),
    ...(value.memoryBytes !== undefined
      ? { memoryBytes: value.memoryBytes }
      : {}),
    ...(value.passedTestCount !== undefined
      ? { passedTestCount: value.passedTestCount }
      : {}),
    ...(value.score !== undefined ? { score: value.score } : {}),
    ...(value.sourceCode !== undefined ? { sourceCode: value.sourceCode } : {}),
    tests: value.tests.map((test) => ({
      index: test.index,
      ...(test.verdict ? { verdict: test.verdict } : {}),
      ...(test.timeMs !== undefined ? { timeMs: test.timeMs } : {}),
      ...(test.memoryBytes !== undefined
        ? { memoryBytes: test.memoryBytes }
        : {}),
      ...(test.exitCode !== undefined ? { exitCode: test.exitCode } : {}),
      ...(test.checkerExitCode !== undefined
        ? { checkerExitCode: test.checkerExitCode }
        : {}),
      ...(test.input !== undefined ? { input: test.input } : {}),
      ...(test.output !== undefined ? { output: test.output } : {}),
      ...(test.answer !== undefined ? { answer: test.answer } : {}),
      ...(test.checkerLog !== undefined ? { checkerLog: test.checkerLog } : {}),
    })),
    truncated: value.truncated,
  };
}

export interface LuoguCrossOjRecordRoute {
  submissionId: string;
  oj: "codeforces" | "atcoder";
  contestId: string;
  problemId: string;
}

function contestIdFromLuoguProblemId(
  oj: LuoguCrossOjRecordRoute["oj"],
  problemId: string,
): string | undefined {
  if (oj === "codeforces")
    return /^CF(\d{1,10})[A-Z]\d*$/i.exec(problemId)?.[1];
  return /^AT_([a-z0-9-]{1,64})_[a-z0-9_-]+$/i
    .exec(problemId)?.[1]
    ?.toLowerCase();
}

export function safeLuoguReturnUrl(
  raw: string | undefined,
): string | undefined {
  if (!raw || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw);
    return url.origin === "https://www.luogu.com.cn" &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function buildLuoguCrossOjRecordUrl(
  oj: LuoguCrossOjRecordRoute["oj"],
  contestId: string,
  submissionId: string,
  problemId: string,
  baseUrl = "https://www.luogu.com.cn/record/list",
): string | undefined {
  const validContest =
    oj === "codeforces"
      ? /^\d{1,10}$/.test(contestId)
      : /^[a-z0-9-]{1,64}$/i.test(contestId);
  if (!validContest || !/^\d{1,20}$/.test(submissionId)) return undefined;
  const normalizedProblemId =
    oj === "codeforces"
      ? /^\d{1,10}\/[A-Za-z]\d*$/.test(problemId)
        ? `CF${problemId.replace("/", "")}`
        : /^CF\d+[A-Za-z]\d*$/i.test(problemId)
          ? problemId.toUpperCase()
          : undefined
      : /^AT_[A-Za-z0-9_-]+$/i.test(problemId)
        ? problemId
        : /^[A-Za-z0-9_-]+$/.test(problemId)
          ? `AT_${problemId}`
          : undefined;
  if (!normalizedProblemId) return undefined;
  const pidContestId = contestIdFromLuoguProblemId(oj, normalizedProblemId);
  if (!pidContestId || pidContestId.toLowerCase() !== contestId.toLowerCase())
    return undefined;
  try {
    const url = new URL(baseUrl);
    if (url.origin !== "https://www.luogu.com.cn") return undefined;
    url.pathname = "/record/list";
    url.searchParams.set("pid", normalizedProblemId);
    url.hash = `#ojtrace-record=${oj === "codeforces" ? "cf" : "at"}/${encodeURIComponent(submissionId)}`;
    return url.href;
  } catch {
    return undefined;
  }
}

export function readLuoguCrossOjRecordRoute(
  rawUrl: string,
): LuoguCrossOjRecordRoute | undefined {
  try {
    const url = new URL(rawUrl);
    if (
      url.origin !== "https://www.luogu.com.cn" ||
      url.username ||
      url.password
    )
      return undefined;
    if (url.pathname !== "/record/list") return undefined;
    const hash = /^#ojtrace-record=(cf|at)\/(?:([^/]+)\/)?(\d{1,20})$/.exec(
      url.hash,
    );
    const problemId = url.searchParams.get("pid");
    if (!hash || !problemId || url.searchParams.getAll("pid").length !== 1)
      return undefined;
    const oj = hash[1] === "cf" ? "codeforces" : "atcoder";
    const legacyContestId = hash[2];
    const submissionId = hash[3]!;
    const contestId = contestIdFromLuoguProblemId(oj, problemId);
    if (!contestId) return undefined;
    if (
      (oj === "codeforces" && !/^\d{1,10}$/.test(contestId)) ||
      (oj === "atcoder" && !/^[a-z0-9-]{1,64}$/i.test(contestId)) ||
      (legacyContestId &&
        legacyContestId.toLowerCase() !== contestId.toLowerCase())
    )
      return undefined;
    const normalizedProblemId = problemId.toUpperCase();
    if (
      (oj === "codeforces" &&
        !new RegExp(`^CF${contestId}[A-Z]\\d*$`, "i").test(problemId)) ||
      (oj === "atcoder" &&
        !normalizedProblemId.startsWith(`AT_${contestId.toUpperCase()}_`))
    )
      return undefined;
    return { oj, contestId, submissionId, problemId };
  } catch {
    return undefined;
  }
}

export async function ensureCodeforcesTestDetailsExpanded(
  doc: Document,
  waitMs = 5_000,
): Promise<void> {
  if (parseTests(protocolText(doc)).tests.length) return;
  const expander = protocolExpander(doc);
  if (!expander) return;
  expander.click();
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    if (parseTests(protocolText(doc)).tests.length) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
}
