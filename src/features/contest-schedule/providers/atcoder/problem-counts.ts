import type { ContestProblemCountProvider } from "../../core/types";
import { ContestProviderError, type FetchLike } from "../types";

export const ATCODER_CONTEST_PROBLEMS_URL =
  "https://kenkoooo.com/atcoder/resources/contest-problem.json";

export function parseAtcoderProblemCounts(
  value: unknown,
  contestIds?: ReadonlySet<string>,
): Map<string, number> {
  if (!Array.isArray(value))
    throw new ContestProviderError(
      "atcoder",
      "invalid-response",
      "AtCoder Problems 比赛题目映射格式无效。",
    );
  const problems = new Map<string, Set<string>>();
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.contest_id !== "string" ||
      !item.contest_id.trim() ||
      typeof item.problem_id !== "string" ||
      !item.problem_id.trim()
    )
      continue;
    const contestId = item.contest_id.trim();
    if (contestIds && !contestIds.has(contestId)) continue;
    const problemIds = problems.get(contestId) ?? new Set<string>();
    problemIds.add(item.problem_id.trim());
    problems.set(contestId, problemIds);
  }
  return new Map(
    [...problems].flatMap(([id, problemIds]) =>
      problemIds.size > 0 ? [[id, problemIds.size] as const] : [],
    ),
  );
}

export function createAtcoderProblemCountProvider(
  fetchImpl: FetchLike = fetch,
): ContestProblemCountProvider {
  return async (contestIds, options) => {
    if (contestIds.length === 0) return new Map();
    let response: Response;
    try {
      response = await fetchImpl(ATCODER_CONTEST_PROBLEMS_URL, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        signal: options?.signal ?? AbortSignal.timeout(20_000),
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      const detail = error instanceof Error ? `（${error.message}）` : "";
      throw new ContestProviderError(
        "atcoder",
        "network",
        `读取 AtCoder Problems 题目映射失败${detail}。`,
      );
    }
    if (!response.ok)
      throw new ContestProviderError(
        "atcoder",
        "http",
        `AtCoder Problems 返回 HTTP ${response.status}。`,
        response.status,
      );
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ContestProviderError(
        "atcoder",
        "invalid-response",
        "AtCoder Problems 题目映射不是有效 JSON。",
      );
    }
    return parseAtcoderProblemCounts(value, new Set(contestIds));
  };
}
