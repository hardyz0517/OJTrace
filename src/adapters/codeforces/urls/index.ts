import { sourceDefinitions } from "../../../sources/definitions";

export const CODEFORCES_ORIGIN = sourceDefinitions.codeforces.fixedOrigin;

export function codeforcesListUrl(handle: string): string {
  return `${CODEFORCES_ORIGIN}/submissions/${encodeURIComponent(handle)}`;
}

/** Codeforces does not expose contest kind in user.status; centralize the current ID heuristic. */
export function codeforcesContestPrefix(contestId: number): "contest" | "gym" {
  return contestId >= 100_000 ? "gym" : "contest";
}
