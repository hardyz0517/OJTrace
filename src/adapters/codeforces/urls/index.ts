export function codeforcesListUrl(handle: string): string {
  return `https://codeforces.com/submissions/${encodeURIComponent(handle)}`;
}

/** Codeforces does not expose contest kind in user.status; centralize the current ID heuristic. */
export function codeforcesContestPrefix(contestId: number): "contest" | "gym" {
  return contestId >= 100_000 ? "gym" : "contest";
}
