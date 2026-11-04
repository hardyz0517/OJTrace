import { parseLuoguAtCoderProblem } from "./atcoder";
import { parseLuoguCodeforcesProblem } from "./problem";
import type { CrossOjProblemRef } from "./model";
import type { LuoguPageProblemContext } from "./luogu-page-context";

/** Compare the document route while ignoring Luogu's in-page panel fragment. */
export function sameLuoguPageDocumentUrl(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    if (
      leftUrl.origin !== "https://www.luogu.com.cn" ||
      rightUrl.origin !== "https://www.luogu.com.cn" ||
      leftUrl.username ||
      leftUrl.password ||
      rightUrl.username ||
      rightUrl.password
    )
      return false;
    leftUrl.hash = "";
    rightUrl.hash = "";
    return leftUrl.href === rightUrl.href;
  } catch {
    return false;
  }
}

export function resolveLuoguProblem(
  rawUrl: string,
  context?: LuoguPageProblemContext,
): { problemId: string; problem: CrossOjProblemRef } | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.origin !== "https://www.luogu.com.cn" || url.username || url.password)
    return undefined;

  const queryIds = url.searchParams.getAll("pid");
  const path = /^\/problem\/([^/]+)\/?$/i.exec(url.pathname);
  let pathId: string | undefined;
  try {
    pathId = path ? decodeURIComponent(path[1]!) : undefined;
  } catch {
    return undefined;
  }
  if (queryIds.length > 1) return undefined;
  if (
    pathId &&
    queryIds[0] &&
    pathId.toUpperCase() !== queryIds[0].toUpperCase()
  )
    return undefined;
  const problemId = queryIds[0] ?? pathId;
  if (!problemId) return undefined;
  if (context && context.problemId.toUpperCase() !== problemId.toUpperCase())
    return undefined;

  const atcoderOriginUrl =
    context?.type === "AT" ? context.atcoderOriginUrl : undefined;
  const problem =
    parseLuoguCodeforcesProblem(problemId) ??
    parseLuoguAtCoderProblem(problemId, atcoderOriginUrl);
  return problem ? { problemId, problem } : undefined;
}

export function sameLuoguProblem(
  actual: CrossOjProblemRef | undefined,
  expected: CrossOjProblemRef,
): boolean {
  if (!actual || actual.oj !== expected.oj) return false;
  if (actual.oj === "codeforces" && expected.oj === "codeforces")
    return (
      actual.contestId === expected.contestId &&
      actual.index.toUpperCase() === expected.index.toUpperCase()
    );
  return (
    actual.oj === "atcoder" &&
    expected.oj === "atcoder" &&
    actual.contestId === expected.contestId &&
    actual.taskId === expected.taskId &&
    actual.originUrl === expected.originUrl
  );
}
