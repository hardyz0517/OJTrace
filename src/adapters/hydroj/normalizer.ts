import type { VerdictCode } from "../../domain";
import type { HydroOJRawRecord } from "./parser";

const VERDICTS: Record<string, VerdictCode> = {
  "0": "pending",
  "1": "accepted",
  "2": "wrong_answer",
  "3": "time_limit",
  "4": "memory_limit",
  "5": "rejected",
  "6": "runtime_error",
  "7": "compilation_error",
  "8": "other",
  "9": "skipped",
  "10": "other",
  "11": "rejected",
  "20": "pending",
  "21": "pending",
  "22": "pending",
  "30": "skipped",
  "31": "rejected",
  "32": "accepted",
  "33": "rejected",
  accepted: "accepted",
  "wrong answer": "wrong_answer",
  wrong_answer: "wrong_answer",
  "time limit exceeded": "time_limit",
  "time exceeded": "time_limit",
  "memory limit exceeded": "memory_limit",
  "output limit exceeded": "rejected",
  "output exceeded": "rejected",
  "compile error": "compilation_error",
  "compilation error": "compilation_error",
  "runtime error": "runtime_error",
  "system error": "other",
  "format error": "rejected",
  canceled: "skipped",
  cancelled: "skipped",
  running: "pending",
  compiling: "pending",
  fetched: "pending",
  waiting: "pending",
};

const HYDRO_LANGUAGE_LABELS: Record<string, string> = {
  c: "C",
  cc: "C++",
  "cc.cc98": "C++98",
  "cc.cc98o2": "C++98(O2)",
  "cc.cc11": "C++11",
  "cc.cc11o2": "C++11(O2)",
  "cc.cc14": "C++14",
  "cc.cc14o2": "C++14(O2)",
  "cc.cc17": "C++17",
  "cc.cc17o2": "C++17(O2)",
  "cc.cc20": "C++20",
  "cc.cc20o2": "C++20(O2)",
  pas: "Pascal",
  java: "Java",
  kt: "Kotlin",
  "kt.jvm": "Kotlin/JVM",
  py: "Python",
  "py.py2": "Python 2",
  "py.py3": "Python 3",
  "py.pypy3": "PyPy3",
  php: "PHP",
  rs: "Rust",
  hs: "Haskell",
  js: "NodeJS",
  go: "Golang",
  rb: "Ruby",
  cs: "C#",
  r: "R",
  bash: "Bash",
};

export function hydroOJLanguageDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim();
  if (!key) return undefined;
  return HYDRO_LANGUAGE_LABELS[key] ?? key;
}

function recordTimestamp(raw: HydroOJRawRecord): {
  timestamp: number;
  basis: "submit-at" | "object-id";
} {
  const explicit = parseTimestamp(raw.submitAt);
  if (explicit !== undefined)
    return { timestamp: explicit, basis: "submit-at" };
  if (raw.submitAt !== undefined)
    throw new Error("HydroOJ record has an invalid submission timestamp");
  const id = raw._id ?? raw.rid;
  if (id && /^[0-9a-f]{24}$/i.test(id))
    return {
      timestamp: parseInt(id.slice(0, 8), 16) * 1000,
      basis: "object-id",
    };
  throw new Error("HydroOJ record has no valid timestamp");
}

function parseTimestamp(
  value: HydroOJRawRecord["submitAt"],
): number | undefined {
  const valid = (timestamp: number) =>
    Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : undefined;
  if (value instanceof Date) return valid(value.getTime());
  if (typeof value === "number")
    return valid(value < 1e12 ? value * 1000 : value);
  if (typeof value === "string") {
    const numeric = Number(value);
    if (value.trim() && Number.isFinite(numeric))
      return valid(numeric < 1e12 ? numeric * 1000 : numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return valid(parsed);
  }
  return undefined;
}

export function normalizeHydroOJSubmission(raw: HydroOJRawRecord): {
  submissionId: string;
  problemId: string;
  problemName?: string;
  submittedAt: number;
  timestampBasis: "submit-at" | "object-id";
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
  const { timestamp, basis } = recordTimestamp(raw);
  if (!Number.isFinite(timestamp))
    throw new Error("HydroOJ record has an invalid timestamp");
  return {
    submissionId: String(id),
    problemId: raw.pid === undefined ? `record-${id}` : String(raw.pid),
    ...(raw.problemName ? { problemName: String(raw.problemName).trim() } : {}),
    submittedAt: timestamp,
    timestampBasis: basis,
    verdict: {
      code: VERDICTS[status] ?? VERDICTS[String(raw.status)] ?? "other",
      raw: rawStatus,
    },
    score: Number.isFinite(raw.score) ? raw.score : undefined,
    timeMs: Number.isFinite(raw.time) ? raw.time : undefined,
    memoryKb: Number.isFinite(raw.memory) ? raw.memory : undefined,
    language: hydroOJLanguageDisplayName(raw.lang),
    submissionPath:
      typeof raw.submissionUrl === "string" ? raw.submissionUrl : undefined,
    problemPath:
      typeof raw.problemUrl === "string" ? raw.problemUrl : undefined,
  };
}
