import type { Submission, VerdictCode } from "../../domain";
import type { AtCoderRawSubmission } from "./parser";
import { atcoderContestSubmissionUrl, atcoderProblemUrl } from "./urls";

const VERDICTS: Record<string, VerdictCode> = {
  AC: "accepted",
  WA: "wrong_answer",
  CE: "compilation_error",
  RE: "runtime_error",
  TLE: "time_limit",
  MLE: "memory_limit",
  WJ: "pending",
  WR: "rejected",
  IE: "other",
  OLE: "other",
  QLE: "other",
};

export function normalizeAtCoderSubmission(
  raw: AtCoderRawSubmission,
  accountId: string,
  providerAccountKey: string,
  fetchedAt: number,
  problemName?: string,
): Submission {
  if (!Number.isInteger(Number(raw.id)) || !Number.isFinite(raw.epochSecond))
    throw new Error("AtCoder submission has invalid id or timestamp");
  return {
    source: "atcoder",
    accountId,
    providerAccountKey,
    submissionId: raw.id,
    identityQuality: "stable",
    problemId: raw.problemId,
    submittedAt: raw.epochSecond * 1000,
    verdict: { code: VERDICTS[raw.result] ?? "other", raw: raw.result },
    score: Number.isFinite(raw.point) ? raw.point : undefined,
    timeMs: Number.isFinite(raw.executionTime) ? raw.executionTime : undefined,
    memoryKb: Number.isFinite(raw.memory) ? raw.memory : undefined,
    language: raw.language,
    problemName,
    submissionUrl: atcoderContestSubmissionUrl(raw.contestId, raw.id),
    problemUrl: atcoderProblemUrl(raw.contestId, raw.problemId),
    fetchedAt,
  };
}
