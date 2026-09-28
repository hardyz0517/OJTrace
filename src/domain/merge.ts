import type { Submission } from "./types";

export function submissionKey(item: Submission): string {
  return [item.source, item.accountId, item.submissionId].join("|");
}

function prefer<T>(
  current: T | undefined,
  incoming: T | undefined,
): T | undefined {
  return incoming ?? current;
}

export function mergeSubmission(
  current: Submission,
  incoming: Submission,
): Submission {
  return {
    ...current,
    ...incoming,
    providerAccountKey: prefer(
      current.providerAccountKey,
      incoming.providerAccountKey,
    ),
    problemName: prefer(current.problemName, incoming.problemName),
    language: prefer(current.language, incoming.language),
    submissionUrl: prefer(current.submissionUrl, incoming.submissionUrl),
    problemUrl: prefer(current.problemUrl, incoming.problemUrl),
    fallbackListUrl: prefer(current.fallbackListUrl, incoming.fallbackListUrl),
    fetchedAt: Math.max(current.fetchedAt, incoming.fetchedAt),
  };
}

export function mergeSubmissions(
  existing: readonly Submission[],
  incoming: readonly Submission[],
  retentionPerAccount: number,
): Submission[] {
  const map = new Map<string, Submission>();
  for (const item of existing) map.set(submissionKey(item), item);
  for (const item of incoming) {
    const key = submissionKey(item);
    const previous = map.get(key);
    map.set(key, previous ? mergeSubmission(previous, item) : item);
  }

  const records = [...map.values()].sort((a, b) => {
    const time = b.submittedAt - a.submittedAt;
    if (time !== 0) return time;
    return submissionKey(a).localeCompare(submissionKey(b));
  });

  const counts = new Map<string, number>();
  return records.filter((item) => {
    const count = counts.get(item.accountId) ?? 0;
    if (count >= retentionPerAccount) return false;
    counts.set(item.accountId, count + 1);
    return true;
  });
}
