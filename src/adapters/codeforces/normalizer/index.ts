import type { Submission, VerdictCode } from "../../../domain";
import type { CodeforcesRawSubmission } from "../parser";
import { codeforcesContestPrefix } from "../urls";

const VERDICTS: Record<string, VerdictCode> = {
  OK: "accepted",
  WRONG_ANSWER: "wrong_answer",
  COMPILATION_ERROR: "compilation_error",
  RUNTIME_ERROR: "runtime_error",
  TIME_LIMIT_EXCEEDED: "time_limit",
  MEMORY_LIMIT_EXCEEDED: "memory_limit",
  TESTING: "pending",
  SUBMITTED: "pending",
  PARTIAL: "partial",
  SKIPPED: "skipped",
  REJECTED: "rejected",
};

export function normalizeCodeforcesVerdict(
  raw: string | undefined,
): VerdictCode {
  return VERDICTS[raw ?? ""] ?? "other";
}

export function normalizeCodeforcesSubmission(
  raw: CodeforcesRawSubmission,
  accountId: string,
  providerAccountKey: string,
  fetchedAt: number,
): Submission {
  if (!Number.isInteger(raw.id) || !Number.isFinite(raw.creationTimeSeconds)) {
    throw new Error("Codeforces submission has invalid id or timestamp");
  }
  const contestId = raw.contestId ?? raw.problem?.contestId;
  const index = raw.problem?.index;
  const problemId =
    contestId && index ? `${contestId}${index}` : `submission-${raw.id}`;
  const prefix =
    contestId === undefined ? undefined : codeforcesContestPrefix(contestId);
  return {
    source: "codeforces",
    accountId,
    providerAccountKey,
    submissionId: String(raw.id),
    identityQuality: "stable",
    problemId,
    problemName: raw.problem?.name,
    submittedAt: raw.creationTimeSeconds * 1_000,
    verdict: {
      code: normalizeCodeforcesVerdict(raw.verdict),
      raw: raw.verdict ?? "UNKNOWN",
    },
    language: raw.programmingLanguage,
    submissionUrl: prefix
      ? `https://codeforces.com/${prefix}/${contestId}/submission/${raw.id}`
      : undefined,
    problemUrl:
      prefix && index
        ? `https://codeforces.com/${prefix}/${contestId}/problem/${encodeURIComponent(index)}`
        : undefined,
    fallbackListUrl: `https://codeforces.com/submissions/${encodeURIComponent(providerAccountKey)}`,
    fetchedAt,
  };
}
