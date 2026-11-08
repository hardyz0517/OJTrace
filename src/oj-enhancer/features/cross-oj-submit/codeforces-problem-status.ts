import type { ProblemHistoryStatus, ProblemRef } from "./model";

export const CODEFORCES_STATUS_PAGE_SIZE = 1000;
export const CODEFORCES_STATUS_MAX_PAGES = 20;

export interface CodeforcesStatusPage {
  status: "OK" | "FAILED";
  comment?: string;
  result?: Array<{
    id?: unknown;
    problem?: {
      contestId?: unknown;
      index?: unknown;
    };
    verdict?: unknown;
  }>;
}

export interface CodeforcesStatusQueryResult {
  status: ProblemHistoryStatus;
  message?: string;
}

export function codeforcesContestStatusUrl(
  contestId: string,
  handle: string,
  from: number,
): string {
  const params = new URLSearchParams({
    contestId,
    handle,
    from: String(from),
    count: String(CODEFORCES_STATUS_PAGE_SIZE),
  });
  return `https://codeforces.com/api/contest.status?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePage(value: unknown): CodeforcesStatusPage {
  if (!isRecord(value) || (value.status !== "OK" && value.status !== "FAILED"))
    throw new Error("Codeforces returned an invalid status response.");
  if (value.status === "FAILED") {
    const comment =
      typeof value.comment === "string"
        ? value.comment.slice(0, 200)
        : "Codeforces API request failed.";
    throw new Error(comment);
  }
  if (
    !Array.isArray(value.result) ||
    value.result.length > CODEFORCES_STATUS_PAGE_SIZE
  )
    throw new Error("Codeforces returned an invalid submission list.");
  return {
    status: "OK",
    result: value.result as CodeforcesStatusPage["result"],
  };
}

function targetSubmissions(
  page: CodeforcesStatusPage,
  problem: ProblemRef,
): Array<NonNullable<CodeforcesStatusPage["result"]>[number]> {
  return (page.result ?? []).filter((submission) => {
    const contestId = submission.problem?.contestId;
    const index = submission.problem?.index;
    return (
      String(contestId ?? "") === problem.contestId &&
      typeof index === "string" &&
      index.toUpperCase() === problem.index.toUpperCase()
    );
  });
}

async function queryHandle(
  handle: string,
  problem: ProblemRef,
  requestPage: (url: string) => Promise<unknown>,
): Promise<"accepted" | "unaccepted" | "none"> {
  let from = 1;
  let hasSubmission = false;
  for (
    let pageNumber = 0;
    pageNumber < CODEFORCES_STATUS_MAX_PAGES;
    pageNumber += 1
  ) {
    const page = parsePage(
      await requestPage(
        codeforcesContestStatusUrl(problem.contestId, handle, from),
      ),
    );
    const matching = targetSubmissions(page, problem);
    if (matching.some((submission) => submission.verdict === "OK"))
      return "accepted";
    if (matching.length > 0) hasSubmission = true;
    const count = page.result?.length ?? 0;
    if (count < CODEFORCES_STATUS_PAGE_SIZE)
      return hasSubmission ? "unaccepted" : "none";
    from += CODEFORCES_STATUS_PAGE_SIZE;
  }
  throw new Error("Codeforces submission history exceeds the scan limit.");
}

/** Query every enabled handle; a failed account must not become a false no-submission result. */
export async function queryCodeforcesProblemHistoryStatus(input: {
  handles: readonly string[];
  problem: ProblemRef;
  requestPage: (url: string) => Promise<unknown>;
}): Promise<CodeforcesStatusQueryResult> {
  const seenHandles = new Set<string>();
  const handles = input.handles
    .map((handle) => handle.trim())
    .filter((handle) => {
      const normalized = handle.toLowerCase();
      if (!/^[A-Za-z0-9_.-]{3,24}$/.test(handle) || seenHandles.has(normalized))
        return false;
      seenHandles.add(normalized);
      return true;
    });
  if (!handles.length)
    return {
      status: "unavailable",
      message: "请先在 OJTrace 中配置并启用 Codeforces 账号。",
    };

  let hasSubmission = false;
  let queryError: unknown;
  for (const handle of handles) {
    let result: "accepted" | "unaccepted" | "none";
    try {
      result = await queryHandle(handle, input.problem, input.requestPage);
    } catch (error) {
      queryError ??= error;
      continue;
    }
    if (result === "accepted") return { status: "accepted" };
    if (result === "unaccepted") hasSubmission = true;
  }
  if (queryError !== undefined)
    return {
      status: "unavailable",
      message:
        queryError instanceof Error
          ? `Codeforces 查询失败：${queryError.message.slice(0, 180)}`
          : "Codeforces 查询失败，请稍后重试。",
    };
  return { status: hasSubmission ? "unaccepted" : "none" };
}
