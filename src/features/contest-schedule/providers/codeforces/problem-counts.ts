import type { ContestProblemCountProvider } from "../../core/types";
import {
  ContestProviderError,
  isObject,
  type FetchLike,
  requestText,
} from "../types";

export const CODEFORCES_PROBLEMSET_URL =
  "https://codeforces.com/api/problemset.problems";

export function parseCodeforcesProblemCounts(
  value: unknown,
  contestIds?: ReadonlySet<string>,
): Map<string, number> {
  if (
    !isObject(value) ||
    value.status !== "OK" ||
    !isObject(value.result) ||
    !Array.isArray(value.result.problems)
  )
    throw new ContestProviderError(
      "codeforces",
      "invalid-response",
      "Codeforces 题目列表响应格式无效。",
    );

  const indices = new Map<string, Set<string>>();
  for (const item of value.result.problems) {
    if (
      !isObject(item) ||
      !Number.isSafeInteger(item.contestId) ||
      (item.contestId as number) <= 0 ||
      typeof item.index !== "string" ||
      !item.index.trim()
    )
      continue;
    const id = String(item.contestId);
    if (contestIds && !contestIds.has(id)) continue;
    const problemIndices = indices.get(id) ?? new Set<string>();
    problemIndices.add(item.index.trim());
    indices.set(id, problemIndices);
  }
  return new Map(
    [...indices].flatMap(([id, problemIndices]) =>
      problemIndices.size > 0 ? [[id, problemIndices.size] as const] : [],
    ),
  );
}

export function createCodeforcesProblemCountProvider(
  fetchImpl: FetchLike = fetch,
): ContestProblemCountProvider {
  return async (contestIds, options) => {
    if (contestIds.length === 0) return new Map();
    const text = await requestText(
      "codeforces",
      CODEFORCES_PROBLEMSET_URL,
      (input, init) =>
        fetchImpl(input, { ...init, signal: options?.signal ?? init?.signal }),
    );
    try {
      return parseCodeforcesProblemCounts(
        JSON.parse(text),
        new Set(contestIds),
      );
    } catch (error) {
      if (error instanceof ContestProviderError) throw error;
      throw new ContestProviderError(
        "codeforces",
        "invalid-response",
        "Codeforces 题目列表不是有效 JSON。",
      );
    }
  };
}
