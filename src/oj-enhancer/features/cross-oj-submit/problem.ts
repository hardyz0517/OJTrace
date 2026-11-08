import type { ProblemRef } from "./model";

const PID_PATTERN = /^CF(\d+)([A-Z]\d*)$/i;
const CONTEST_PATH_PATTERNS = [
  /^\/contest\/(\d+)\/problem\/([A-Z]\d*)\/?$/i,
  /^\/problemset\/problem\/(\d+)\/([A-Z]\d*)\/?$/i,
];

export function parseLuoguCodeforcesProblem(
  problemId: string,
): ProblemRef | undefined {
  const match = PID_PATTERN.exec(problemId.trim());
  if (!match) return undefined;
  return {
    oj: "codeforces",
    contestId: match[1]!,
    index: match[2]!.toUpperCase(),
    source: "luogu-pid",
  };
}

export function parseCodeforcesProblemUrl(
  rawUrl: string,
): ProblemRef | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== "https://codeforces.com" || url.username || url.password)
    return undefined;
  for (const pattern of CONTEST_PATH_PATTERNS) {
    const match = pattern.exec(url.pathname);
    if (match)
      return {
        oj: "codeforces",
        contestId: match[1]!,
        index: match[2]!.toUpperCase(),
        source: "luogu-origin-link",
      };
  }
  return undefined;
}

export function parseCodeforcesSubmitUrl(
  rawUrl: string,
):
  | { kind: "submit"; contestId?: string; index?: string }
  | { kind: "login" }
  | { kind: "other" }
  | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== "https://codeforces.com") return undefined;
  if (url.pathname === "/enter" || url.pathname.startsWith("/enter/"))
    return { kind: "login" };
  const contest = /^\/contest\/(\d+)\/submit\/?$/.exec(url.pathname);
  if (contest)
    return {
      kind: "submit",
      contestId: contest[1],
      index: url.searchParams.get("problemIndex")?.toUpperCase(),
    };
  if (
    url.pathname === "/problemset/submit" ||
    url.pathname === "/problemset/submit/"
  )
    return {
      kind: "submit",
      contestId: url.searchParams.get("contestId") ?? undefined,
      index: url.searchParams.get("problemIndex")?.toUpperCase(),
    };
  return { kind: "other" };
}

export function codeforcesSubmissionFromUrl(
  rawUrl: string,
): { submissionId: string; problem?: ProblemRef } | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== "https://codeforces.com") return undefined;
  const match = /^\/(?:contest\/\d+\/|problemset\/)submission\/(\d+)\/?$/.exec(
    url.pathname,
  );
  if (!match) return undefined;
  return { submissionId: match[1]! };
}

export function problemIdsMatch(left: ProblemRef, right: ProblemRef): boolean {
  return (
    left.contestId === right.contestId &&
    left.index.toUpperCase() === right.index.toUpperCase()
  );
}
