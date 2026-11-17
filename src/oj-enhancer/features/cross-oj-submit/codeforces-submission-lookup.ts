import type { ProblemRef } from "./model";

const HANDLE_PATTERN = /^[A-Za-z0-9_.-]{3,24}$/;

export type CodeforcesSubmissionLookup =
  | { status: "pending" }
  | { status: "matched"; detailUrl: string }
  | { status: "ambiguous" }
  | { status: "unavailable" };

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function positiveIntegerString(value: unknown): string | undefined {
  const candidate =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : typeof value === "string" && /^\d{1,20}$/.test(value)
        ? value
        : undefined;
  return candidate && BigInt(candidate) > 0n ? candidate : undefined;
}

export function codeforcesUserStatusUrl(
  handle: string,
  count: number,
): string | undefined {
  if (
    !HANDLE_PATTERN.test(handle) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 1000
  )
    return undefined;
  const params = new URLSearchParams({
    handle,
    from: "1",
    count: String(count),
  });
  return `https://codeforces.com/api/user.status?${params.toString()}`;
}

export function latestCodeforcesSubmissionId(
  value: unknown,
): string | undefined {
  const response = recordOf(value);
  if (response?.status !== "OK" || !Array.isArray(response.result))
    return undefined;
  let latest: string | undefined;
  for (const item of response.result) {
    const id = positiveIntegerString(recordOf(item)?.id);
    if (id && (!latest || BigInt(id) > BigInt(latest))) latest = id;
  }
  return latest ?? "0";
}

export function lookupCodeforcesSubmission(
  value: unknown,
  input: {
    problem: ProblemRef;
    handle: string;
    baselineSubmissionId: string;
    submitObservedAt: number;
    now?: number;
  },
): CodeforcesSubmissionLookup {
  const response = recordOf(value);
  if (
    response?.status !== "OK" ||
    !Array.isArray(response.result) ||
    response.result.length > 1000 ||
    !HANDLE_PATTERN.test(input.handle) ||
    !/^\d{1,20}$/.test(input.baselineSubmissionId) ||
    !Number.isFinite(input.submitObservedAt)
  )
    return { status: "unavailable" };

  const now = input.now ?? Date.now();
  if (!Number.isFinite(now)) return { status: "unavailable" };
  const candidates = new Map<string, string>();
  for (const raw of response.result) {
    const submission = recordOf(raw);
    if (!submission) continue;
    const id = positiveIntegerString(submission.id);
    const problem = recordOf(submission.problem);
    const author = recordOf(submission.author);
    const members = Array.isArray(author?.members) ? author.members : [];
    const authoredByHandle = members.some(
      (member) =>
        recordOf(member)?.handle?.toString().toLowerCase() ===
        input.handle.toLowerCase(),
    );
    const contestId = String(problem?.contestId ?? submission.contestId ?? "");
    const index = String(problem?.index ?? "").toUpperCase();
    const seconds = Number(submission.creationTimeSeconds);
    const submittedAt = seconds * 1000;
    if (
      !id ||
      BigInt(id) <= BigInt(input.baselineSubmissionId) ||
      contestId !== input.problem.contestId ||
      index !== input.problem.index.toUpperCase() ||
      !authoredByHandle ||
      !Number.isSafeInteger(seconds) ||
      submittedAt < input.submitObservedAt - 30_000 ||
      submittedAt > input.submitObservedAt + 30_000 ||
      submittedAt > now + 30_000
    )
      continue;
    candidates.set(
      id,
      `https://codeforces.com/contest/${encodeURIComponent(contestId)}/submission/${encodeURIComponent(id)}`,
    );
  }

  if (candidates.size === 0) return { status: "pending" };
  if (candidates.size > 1) return { status: "ambiguous" };
  const detailUrl = candidates.values().next().value;
  return detailUrl
    ? { status: "matched", detailUrl }
    : { status: "unavailable" };
}
