import type { ContestRecord } from "../../core/types";
import { ContestProviderError, type FetchLike, requestText } from "../types";
import { parseAtcoderContestPage } from "./parser";

export const ATCODER_CONTEST_LIST_URL = "https://atcoder.jp/contests/";

export async function fetchAtcoderContests(
  options: {
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
    now?: number;
  } = {},
): Promise<ContestRecord[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const html = await requestText(
    "atcoder",
    ATCODER_CONTEST_LIST_URL,
    (input, init) =>
      fetchImpl(input, { ...init, signal: options.signal ?? init?.signal }),
  );
  try {
    return parseAtcoderContestPage(html, options.now);
  } catch (error) {
    if (error instanceof ContestProviderError) throw error;
    throw new ContestProviderError(
      "atcoder",
      "invalid-response",
      "解析 AtCoder 比赛列表失败。",
    );
  }
}
