import type { Submission, VerdictCode } from "../../domain";
import { qojSubmissionUrl, qojSubmissionListUrl } from "./urls";
import type { QOJRawRecord } from "./parser";

function verdict(
  raw: string | undefined,
  score: number | undefined,
): { code: VerdictCode; raw: string } {
  const value = (raw ?? "").trim();
  const lower = value.toLowerCase();
  if (score !== undefined) {
    return {
      code: score >= 100 ? "accepted" : "partial",
      raw: value || String(score),
    };
  }
  if (/waiting|judging|running|queue|pending|评测中|等待/i.test(lower))
    return { code: "pending", raw: value };
  if (/compile|compilation|编译/i.test(lower))
    return { code: "compilation_error", raw: value };
  if (/wrong|answer|wa|答案错误/i.test(lower))
    return { code: "wrong_answer", raw: value };
  if (/time|tle|超时/i.test(lower)) return { code: "time_limit", raw: value };
  if (/memory|mle|内存/i.test(lower))
    return { code: "memory_limit", raw: value };
  if (/runtime|re|运行/i.test(lower))
    return { code: "runtime_error", raw: value };
  if (/accepted|success|ac|通过/i.test(lower))
    return { code: "accepted", raw: value };
  return { code: "other", raw: value || "UNKNOWN" };
}

function submittedAt(value: string | undefined): number {
  if (!value) throw new Error("QOJ record has no submit time");
  const number = Number(value);
  if (Number.isFinite(number))
    return number < 10_000_000_000 ? number * 1_000 : number;
  const normalized = value.trim().replace(" ", "T");
  const parsed = Date.parse(
    /[zZ]|[+-]\d\d:?\d\d$/.test(normalized)
      ? normalized
      : `${normalized}+08:00`,
  );
  if (!Number.isFinite(parsed))
    throw new Error("QOJ record has an invalid submit time");
  return parsed;
}

export function normalizeQOJRecord(
  raw: QOJRawRecord,
  accountId: string,
  username: string,
  fetchedAt: number,
): Submission {
  if (!/^[1-9][0-9]{0,9}$/.test(raw.id))
    throw new Error("QOJ record has no stable id");
  if (!raw.problemId) throw new Error("QOJ record has no problem id");
  return {
    source: "qoj",
    accountId,
    providerAccountKey: username,
    submissionId: raw.id,
    identityQuality: "stable",
    problemId: raw.problemId,
    problemName: raw.problemName,
    submittedAt: submittedAt(raw.submittedAt),
    verdict: verdict(raw.result, raw.score),
    score: raw.score,
    timeMs: raw.timeMs,
    memoryKb: raw.memoryKb,
    codeLength: raw.codeLength,
    language: raw.language,
    submissionUrl: qojSubmissionUrl(raw.id),
    problemUrl: raw.problemUrl,
    fallbackListUrl: qojSubmissionListUrl(username),
    fetchedAt,
  };
}
