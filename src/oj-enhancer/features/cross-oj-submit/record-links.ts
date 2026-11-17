import { canonicalCrossOjDetailUrl } from "./history";
import { resolveLuoguProblem } from "./luogu-problem";

export function safeLuoguReturnUrl(
  raw: string | undefined,
): string | undefined {
  if (!raw || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw);
    return url.origin === "https://www.luogu.com.cn" &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** Redirect bookmarks created by the retired embedded detail page. */
export function legacyLuoguRecordDetailUrl(rawUrl: string): string | undefined {
  const safeUrl = safeLuoguReturnUrl(rawUrl);
  if (!safeUrl) return undefined;
  const url = new URL(safeUrl);
  if (
    url.pathname !== "/record/list" ||
    url.searchParams.getAll("pid").length !== 1
  )
    return undefined;
  const hash = /^#ojtrace-record=(cf|at)\/(?:([^/]+)\/)?(\d{1,20})$/.exec(
    url.hash,
  );
  if (!hash) return undefined;
  const problem = resolveLuoguProblem(url.href)?.problem;
  if (
    !problem ||
    (hash[1] === "cf" ? problem.oj !== "codeforces" : problem.oj !== "atcoder")
  )
    return undefined;
  if (hash[2] && hash[2].toLowerCase() !== problem.contestId.toLowerCase())
    return undefined;
  const submissionId = hash[3]!;
  const detailUrl =
    problem.oj === "codeforces"
      ? `https://codeforces.com/contest/${problem.contestId}/submission/${submissionId}`
      : `https://atcoder.jp/contests/${problem.contestId}/submissions/${submissionId}`;
  return canonicalCrossOjDetailUrl(problem.oj, detailUrl, submissionId);
}
