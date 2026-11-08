import type { ContestRecord } from "../../core/types";
import { ContestProviderError, type FetchLike, requestText } from "../types";
import { parseCodeforcesContests } from "./parser";

export const CODEFORCES_CONTEST_LIST_URL =
  "https://codeforces.com/api/contest.list?gym=false";

export async function fetchCodeforcesContests(
  options: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    now?: number;
  } = {},
): Promise<ContestRecord[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let text: string;
  try {
    text = await requestText(
      "codeforces",
      CODEFORCES_CONTEST_LIST_URL,
      (input, init) =>
        fetchImpl(input, { ...init, signal: options.signal ?? init?.signal }),
    );
  } catch (error) {
    if (error instanceof ContestProviderError) throw error;
    throw new ContestProviderError(
      "codeforces",
      "network",
      "获取 Codeforces 比赛列表失败。",
    );
  }
  try {
    return parseCodeforcesContests(JSON.parse(text), options.now);
  } catch (error) {
    if (error instanceof ContestProviderError) throw error;
    throw new ContestProviderError(
      "codeforces",
      "invalid-response",
      "Codeforces 比赛列表不是有效 JSON。",
    );
  }
}
