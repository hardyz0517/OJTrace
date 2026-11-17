import type { CrossOjProblemRef } from "./model";
import { resolveLuoguProblem } from "./luogu-problem";
function recordListPage(
  rawUrl: string,
): { problemId: string; problem: CrossOjProblemRef } | undefined {
  try {
    const url = new URL(rawUrl);
    if (
      url.origin !== "https://www.luogu.com.cn" ||
      url.username ||
      url.password ||
      url.pathname !== "/record/list" ||
      url.searchParams.getAll("pid").length !== 1
    )
      return undefined;
    return resolveLuoguProblem(url.href);
  } catch {
    return undefined;
  }
}

function sameProblemIdentity(
  left: CrossOjProblemRef,
  right: CrossOjProblemRef,
): boolean {
  if (left.oj !== right.oj) return false;
  if (left.oj === "codeforces" && right.oj === "codeforces")
    return (
      left.contestId === right.contestId &&
      left.index.toUpperCase() === right.index.toUpperCase()
    );
  return (
    left.oj === "atcoder" &&
    right.oj === "atcoder" &&
    left.contestId.toLowerCase() === right.contestId.toLowerCase() &&
    left.taskId.toLowerCase() === right.taskId.toLowerCase()
  );
}

function isLuoguOrigin(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return (
      url.origin === "https://www.luogu.com.cn" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * Chrome keeps MessageSender.url at the isolated-world document URL, so a
 * Luogu SPA navigation leaves sender.url on the previous problem page. The
 * current tab URL is the visible route. If tabs.get() has not caught up yet,
 * the content script may also report location.href as pageUrl.
 */
function visibleLuoguRouteUrl(
  senderUrl: string,
  currentTabUrl: string,
  claimedPageUrl: string | undefined,
  parse: (rawUrl: string) => unknown,
): string | undefined {
  if (!isLuoguOrigin(senderUrl)) return undefined;
  if (currentTabUrl && !isLuoguOrigin(currentTabUrl)) return undefined;
  if (currentTabUrl && parse(currentTabUrl)) return currentTabUrl;
  if (claimedPageUrl && isLuoguOrigin(claimedPageUrl) && parse(claimedPageUrl))
    return claimedPageUrl;
  return undefined;
}

/**
 * Authorize a cross-OJ record query from the visible Luogu route alone.
 * Record-list requests do not need to execute code in the page's main world.
 */
export function authorizedLuoguRecordListProblemId(
  senderUrl: string,
  currentTabUrl: string,
  expectedProblem: CrossOjProblemRef,
  claimedPageUrl?: string,
): string | undefined {
  const routeUrl = visibleLuoguRouteUrl(
    senderUrl,
    currentTabUrl,
    claimedPageUrl,
    recordListPage,
  );
  const page = routeUrl ? recordListPage(routeUrl) : undefined;
  return page && sameProblemIdentity(page.problem, expectedProblem)
    ? page.problemId
    : undefined;
}

export function isAuthorizedLuoguRecordListPage(
  senderUrl: string,
  currentTabUrl: string,
  expectedProblem: CrossOjProblemRef,
  claimedPageUrl?: string,
): boolean {
  return (
    authorizedLuoguRecordListProblemId(
      senderUrl,
      currentTabUrl,
      expectedProblem,
      claimedPageUrl,
    ) !== undefined
  );
}
