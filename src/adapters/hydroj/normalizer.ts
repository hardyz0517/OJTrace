import type { VerdictCode } from "../../domain";
import type { HydroOJRawRecord } from "./parser";

const VERDICTS: Record<string, VerdictCode> = {
  "0": "pending",
  "1": "accepted",
  "2": "wrong_answer",
  "3": "time_limit",
  "4": "memory_limit",
  "5": "compilation_error",
  "6": "runtime_error",
  accepted: "accepted",
  "wrong answer": "wrong_answer",
  wrong_answer: "wrong_answer",
  "time limit exceeded": "time_limit",
  "time exceeded": "time_limit",
  "memory limit exceeded": "memory_limit",
  "compile error": "compilation_error",
  "compilation error": "compilation_error",
  "runtime error": "runtime_error",
  waiting: "pending",
};

function recordTimestamp(raw: HydroOJRawRecord): number {
  const value = raw.judgeAt ?? raw.submitAt;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric))
      return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error("HydroOJ record has no valid timestamp");
}

export function normalizeHydroOJSubmission(raw: HydroOJRawRecord): {
  submissionId: string;
  problemId: string;
  problemName?: string;
  submittedAt: number;
  verdict: { code: VerdictCode; raw: string };
  score?: number;
  timeMs?: number;
  memoryKb?: number;
  language?: string;
  submissionPath?: string;
  problemPath?: string;
} {
  const id = raw._id ?? raw.rid;
  if (!id || !/^[0-9a-f]{24}$/i.test(String(id)))
    throw new Error("HydroOJ record has no stable id");
  const rawStatus = String(raw.statusText ?? raw.status ?? "unknown");
  const status = rawStatus.toLowerCase();
  const timestamp = recordTimestamp(raw);
  if (!Number.isFinite(timestamp))
    throw new Error("HydroOJ record has an invalid timestamp");
  return {
    submissionId: String(id),
    problemId: raw.pid === undefined ? `record-${id}` : String(raw.pid),
    ...(raw.problemName ? { problemName: String(raw.problemName).trim() } : {}),
    submittedAt: timestamp,
    verdict: {
      code: VERDICTS[status] ?? VERDICTS[String(raw.status)] ?? "other",
      raw: rawStatus,
    },
    score: Number.isFinite(raw.score) ? raw.score : undefined,
    timeMs: Number.isFinite(raw.time) ? raw.time : undefined,
    memoryKb: Number.isFinite(raw.memory) ? raw.memory : undefined,
    language: typeof raw.lang === "string" ? raw.lang : undefined,
    submissionPath:
      typeof raw.submissionUrl === "string" ? raw.submissionUrl : undefined,
    problemPath:
      typeof raw.problemUrl === "string" ? raw.problemUrl : undefined,
  };
}
