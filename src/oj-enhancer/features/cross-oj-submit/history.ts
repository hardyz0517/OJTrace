import type { CrossOjEvaluationStatus, CrossOjSubmissionRecord } from "./model";

export const CROSS_OJ_HISTORY_LIMIT = 50;

export function canonicalCrossOjDetailUrl(
  oj: CrossOjSubmissionRecord["oj"],
  rawUrl: string,
  submissionId: string,
): string | undefined {
  try {
    const url = new URL(rawUrl);
    const origin =
      oj === "codeforces" ? "https://codeforces.com" : "https://atcoder.jp";
    const match =
      oj === "codeforces"
        ? /^\/(?:contest\/\d+|problemset)\/submission\/(\d+)\/?$/.exec(
            url.pathname,
          )
        : /^\/contests\/[a-z0-9-]+\/submissions\/(\d+)\/?$/i.exec(url.pathname);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      match?.[1] !== submissionId
    )
      return undefined;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): CrossOjSubmissionRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<CrossOjSubmissionRecord>;
  if (
    (record.oj !== "codeforces" && record.oj !== "atcoder") ||
    typeof record.submissionId !== "string" ||
    !/^\d{1,20}$/.test(record.submissionId) ||
    typeof record.problemId !== "string" ||
    record.problemId.length === 0 ||
    record.problemId.length > 80 ||
    typeof record.detailUrl !== "string" ||
    record.detailUrl.length > 2048 ||
    !Number.isFinite(record.observedAt) ||
    !Number.isFinite(record.statusUpdatedAt) ||
    (record.evaluationStatus !== "judging" &&
      record.evaluationStatus !== "accepted" &&
      record.evaluationStatus !== "rejected" &&
      record.evaluationStatus !== "unknown")
  )
    return undefined;
  const detailUrl = canonicalCrossOjDetailUrl(
    record.oj,
    record.detailUrl,
    record.submissionId,
  );
  if (!detailUrl) return undefined;
  // Construct the allowlisted summary; never retain arbitrary fields from storage.
  return {
    oj: record.oj,
    submissionId: record.submissionId,
    problemId: record.problemId,
    detailUrl,
    observedAt: record.observedAt!,
    evaluationStatus: record.evaluationStatus,
    statusUpdatedAt: record.statusUpdatedAt!,
  };
}

function identity(record: CrossOjSubmissionRecord): string {
  return `${record.oj}:${record.submissionId}`;
}

export function readCrossOjHistory(value: unknown): CrossOjSubmissionRecord[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, CrossOjSubmissionRecord>();
  for (const valueItem of value) {
    const item = readRecord(valueItem);
    if (!item) continue;
    const key = identity(item);
    const previous = unique.get(key);
    if (!previous || item.statusUpdatedAt >= previous.statusUpdatedAt)
      unique.set(key, item);
  }
  return [...unique.values()]
    .sort((left, right) => right.observedAt - left.observedAt)
    .slice(0, CROSS_OJ_HISTORY_LIMIT);
}

export function upsertCrossOjHistory(
  history: unknown,
  candidate: CrossOjSubmissionRecord,
): CrossOjSubmissionRecord[] {
  const records = readCrossOjHistory(history);
  const previous = records.find(
    (item) => identity(item) === identity(candidate),
  );
  const statusIsTerminal =
    previous?.evaluationStatus === "accepted" ||
    previous?.evaluationStatus === "rejected";
  const next = previous && statusIsTerminal ? previous : candidate;
  return readCrossOjHistory([
    next,
    ...records.filter((item) => identity(item) !== identity(candidate)),
  ]);
}

export function updateCrossOjEvaluation(
  history: unknown,
  input: {
    detailUrl: string;
    submissionId: string;
    evaluationStatus: CrossOjEvaluationStatus;
    updatedAt: number;
  },
): CrossOjSubmissionRecord[] | undefined {
  const records = readCrossOjHistory(history);
  const index = records.findIndex(
    (record) =>
      record.submissionId === input.submissionId &&
      record.detailUrl ===
        canonicalCrossOjDetailUrl(
          record.oj,
          input.detailUrl,
          input.submissionId,
        ),
  );
  if (index < 0) return undefined;
  const previous = records[index]!;
  const terminal =
    previous.evaluationStatus === "accepted" ||
    previous.evaluationStatus === "rejected";
  if (terminal || input.updatedAt < previous.statusUpdatedAt) return records;
  const updated = [...records];
  updated[index] = {
    ...previous,
    evaluationStatus: input.evaluationStatus,
    statusUpdatedAt: input.updatedAt,
  };
  return updated;
}
