import type { AtCoderProblemRef } from "./model";

const PID_PATTERN = /^AT_([a-z0-9-]+)_([a-z0-9]+)$/i;
const LINKED_PID_PATTERN = /^AT_?([a-z0-9][a-z0-9_-]*)$/i;

function normalizedTaskIdFromLuoguPid(problemId: string): string | undefined {
  const match = LINKED_PID_PATTERN.exec(problemId.trim());
  const taskId = match?.[1]?.toLowerCase();
  return taskId && /\d/.test(taskId) ? taskId : undefined;
}

export function isLuoguAtCoderProblemId(problemId: string): boolean {
  return normalizedTaskIdFromLuoguPid(problemId) !== undefined;
}

export function parseLuoguAtCoderProblem(
  problemId: string,
  originUrl?: string,
): AtCoderProblemRef | undefined {
  if (originUrl !== undefined) {
    const linked = parseAtCoderProblemUrl(originUrl);
    if (!linked || normalizedTaskIdFromLuoguPid(problemId) !== linked.taskId)
      return undefined;
    return linked;
  }
  const match = PID_PATTERN.exec(problemId.trim());
  if (!match) return undefined;
  const contestId = match[1]!.toLowerCase();
  return {
    oj: "atcoder",
    contestId,
    taskId: `${contestId}_${match[2]!.toLowerCase()}`,
    source: "luogu-pid",
  };
}

export function parseAtCoderProblemUrl(
  rawUrl: string,
): AtCoderProblemRef | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== "https://atcoder.jp" || url.username || url.password)
    return undefined;
  const match = /^\/contests\/([a-z0-9-]+)\/tasks\/([a-z0-9_-]+)\/?$/i.exec(
    url.pathname,
  );
  if (!match) return undefined;
  return {
    oj: "atcoder",
    contestId: match[1]!.toLowerCase(),
    taskId: match[2]!.toLowerCase(),
    source: "luogu-origin-link",
    originUrl: `https://atcoder.jp${url.pathname}`,
  };
}

export function parseAtCoderSubmitUrl(
  rawUrl: string,
):
  | { kind: "submit"; contestId?: string }
  | { kind: "login" }
  | { kind: "other" }
  | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== "https://atcoder.jp") return undefined;
  if (url.pathname === "/login" || url.pathname.startsWith("/login/"))
    return { kind: "login" };
  const match = /^\/contests\/([a-z0-9-]+)\/submit\/?$/i.exec(url.pathname);
  return match
    ? { kind: "submit", contestId: match[1]!.toLowerCase() }
    : { kind: "other" };
}

export function atcoderSubmissionFromUrl(
  rawUrl: string,
): { submissionId: string; contestId: string } | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== "https://atcoder.jp") return undefined;
  const match = /^\/contests\/([a-z0-9-]+)\/submissions\/(\d+)\/?$/i.exec(
    url.pathname,
  );
  return match
    ? { contestId: match[1]!.toLowerCase(), submissionId: match[2]! }
    : undefined;
}

export function atcoderSubmitUrl(problem: AtCoderProblemRef): string {
  return `https://atcoder.jp/contests/${encodeURIComponent(problem.contestId)}/submit`;
}

export function atCoderProblemIdsMatch(
  left: AtCoderProblemRef,
  right: AtCoderProblemRef,
): boolean {
  return (
    left.contestId.toLowerCase() === right.contestId.toLowerCase() &&
    left.taskId.toLowerCase() === right.taskId.toLowerCase()
  );
}
