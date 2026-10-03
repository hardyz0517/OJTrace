import type { Submission } from "./types";

function problemKey(item: Submission): string {
  return [item.source, item.accountId, item.problemId].join("|");
}

export function latestSubmissionsPerProblem(
  items: readonly Submission[],
): Submission[] {
  const latestByProblem = new Map<string, Submission>();
  for (const item of items) {
    const key = problemKey(item);
    const current = latestByProblem.get(key);
    if (!current || item.submittedAt > current.submittedAt) {
      latestByProblem.set(key, item);
    }
  }

  return items.filter((item) => latestByProblem.get(problemKey(item)) === item);
}
