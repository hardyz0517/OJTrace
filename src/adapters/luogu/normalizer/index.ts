import type { Submission, VerdictCode } from "../../../domain";
import type { LuoguRawRecord } from "../parser";
import {
  luoguFallbackListUrl,
  luoguProblemUrl,
  luoguSubmissionUrl,
} from "../urls";

const STATUS_MAP: Record<string, VerdictCode> = {
  "0": "pending",
  "1": "pending",
  "2": "compilation_error",
  "3": "other",
  "4": "memory_limit",
  "5": "time_limit",
  "6": "wrong_answer",
  "7": "runtime_error",
  "11": "other",
  "12": "accepted",
  "14": "partial",
  AC: "accepted",
  Accepted: "accepted",
  "Partially Correct": "partial",
  PC: "partial",
  WA: "wrong_answer",
  WrongAnswer: "wrong_answer",
  CE: "compilation_error",
  "Compile Error": "compilation_error",
  RE: "runtime_error",
  "Runtime Error": "runtime_error",
  TLE: "time_limit",
  "Time Limit Exceeded": "time_limit",
  MLE: "memory_limit",
  "Memory Limit Exceeded": "memory_limit",
  OLE: "other",
  Pending: "pending",
  Judging: "pending",
};

const LANGUAGE_MAP: Record<string, string> = {
  "0": "未知",
  "1": "C++98",
  "2": "C++03",
  "3": "C++11",
  "4": "C++14",
  "5": "C++17",
  "6": "C++20",
  "7": "C",
  "8": "Pascal",
  "9": "Python 2",
  "10": "Python 3",
  // Luogu's record list uses 11 for C++14 (the old table incorrectly
  // treated it as Java, which made the UI show the wrong language).
  "11": "C++14",
  "12": "JavaScript",
  "13": "Go",
  "14": "Rust",
  "15": "PHP",
  "16": "Kotlin",
  "17": "C#",
  "28": "Java",
  "29": "JavaScript",
  "30": "Go",
  "31": "Rust",
};

function problemValue(raw: LuoguRawRecord): {
  pid?: string;
  title?: string;
} {
  if (typeof raw.problem === "string") return { pid: raw.problem };
  const problem = raw.problem ?? {};
  return {
    pid: problem.pid ?? problem.problemId,
    title:
      problem.title ??
      problem.name ??
      problem.problemName ??
      problem.content?.name ??
      problem.content?.title,
  };
}

function statusValue(raw: LuoguRawRecord): string {
  if (raw.status && typeof raw.status === "object") {
    return String(raw.status.status ?? raw.status.name ?? "UNKNOWN");
  }
  return String(raw.status ?? "UNKNOWN");
}

function timestampMs(value: number | string | undefined): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (number === undefined || !Number.isFinite(number))
    throw new Error("Luogu record has no valid submitTime");
  return number < 10_000_000_000 ? number * 1_000 : number;
}

export function normalizeLuoguRecord(
  raw: LuoguRawRecord,
  accountId: string,
  providerAccountKey: string,
  fetchedAt: number,
): Submission {
  if (raw.id === undefined || raw.id === null)
    throw new Error("Luogu record has no id");
  const problem = problemValue(raw);
  const problemId =
    problem.pid ?? raw.pid ?? raw.problemId ?? `record-${raw.id}`;
  const rawVerdict = statusValue(raw);
  const detail = raw.detail ?? raw.submission;
  const field = (...names: string[]): unknown => {
    for (const name of names) {
      if (name in raw) return (raw as unknown as Record<string, unknown>)[name];
      if (detail && name in detail) return detail[name];
    }
    return undefined;
  };
  const finiteMetric = (...values: unknown[]): number | undefined => {
    const value = values.find(
      (candidate) => candidate !== undefined && candidate !== null,
    );
    const nested =
      value && typeof value === "object"
        ? (value as { value?: unknown; cost?: unknown })
        : undefined;
    const scalar = nested?.value ?? nested?.cost ?? value;
    const number = typeof scalar === "number" ? scalar : Number(scalar);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
  };
  const languageValue = field(
    "language",
    "lang",
    "languageName",
    "language_name",
  );
  const language =
    languageValue === undefined
      ? undefined
      : (LANGUAGE_MAP[String(languageValue)] ?? String(languageValue));
  return {
    source: "luogu",
    accountId,
    providerAccountKey,
    submissionId: String(raw.id),
    identityQuality: "stable",
    problemId,
    problemName:
      problem.title ??
      raw.problemName ??
      raw.title ??
      raw.content?.name ??
      raw.content?.title,
    submittedAt: timestampMs(raw.submitTime),
    verdict: { code: STATUS_MAP[rawVerdict] ?? "other", raw: rawVerdict },
    score:
      raw.score !== undefined
        ? Number(raw.score)
        : raw.points !== undefined
          ? Number(raw.points)
          : undefined,
    timeMs: finiteMetric(
      field("time", "timeUsed", "timeCost", "time_ms", "timeMs"),
    ),
    memoryKb: finiteMetric(
      field("memory", "memoryUsed", "memoryCost", "memory_kb", "memoryKb"),
    ),
    codeLength: finiteMetric(
      field("codeLength", "codeSize", "sourceLength", "source_length"),
      typeof field("code", "sourceCode", "source_code") === "string"
        ? String(field("code", "sourceCode", "source_code")).length
        : undefined,
    ),
    language,
    submissionUrl: luoguSubmissionUrl(String(raw.id)),
    problemUrl:
      raw.problemUrl ?? (problem.pid ? luoguProblemUrl(problemId) : undefined),
    fallbackListUrl: luoguFallbackListUrl(providerAccountKey),
    fetchedAt,
  };
}
