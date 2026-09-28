import type { Submission, VerdictCode } from "../../../domain";
import type { LuoguRawRecord } from "../parser";

const STATUS_MAP: Record<string, VerdictCode> = {
  AC: "accepted",
  Accepted: "accepted",
  WA: "wrong_answer",
  WrongAnswer: "wrong_answer",
  CE: "compilation_error",
  RE: "runtime_error",
  TLE: "time_limit",
  MLE: "memory_limit",
  Pending: "pending",
  Judging: "pending",
};

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
  const problemId =
    raw.problem?.pid ?? raw.pid ?? raw.problemId ?? `record-${raw.id}`;
  const rawVerdict = String(raw.status ?? "UNKNOWN");
  return {
    source: "luogu",
    accountId,
    providerAccountKey,
    submissionId: String(raw.id),
    identityQuality: "stable",
    problemId,
    problemName: raw.problem?.title ?? raw.problem?.name ?? raw.title,
    submittedAt: timestampMs(raw.submitTime),
    verdict: { code: STATUS_MAP[rawVerdict] ?? "other", raw: rawVerdict },
    language: raw.language ?? raw.lang,
    // The exact single-record route is not verified against an authenticated response yet.
    // Keep the list URL as the safe navigation fallback until Gate 0 evidence is complete.
    submissionUrl: undefined,
    problemUrl:
      (raw.problem?.pid ?? raw.pid)
        ? `https://www.luogu.com.cn/problem/${encodeURIComponent(problemId)}`
        : undefined,
    fallbackListUrl: `https://www.luogu.com.cn/record/list?user=${encodeURIComponent(providerAccountKey)}`,
    fetchedAt,
  };
}
