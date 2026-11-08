import { deduplicateContests } from "../../core/contest-filter";
import { FINISHED_WINDOW_MS, endTimeOf } from "../../core/contest-status";
import type { ContestRecord } from "../../core/types";
import type { HttpClient } from "../../../../domain/adapter";
import { type FetchLike, requestText, requestTextWithClient } from "../types";
import { parseLuoguContestPage } from "./parser";

export const LUOGU_CONTEST_LIST_URL = "https://www.luogu.com.cn/contest/list";
export const LUOGU_MAX_PAGES = 5;

export async function fetchLuoguContests(
  options: {
    fetchImpl?: FetchLike;
    http?: Pick<HttpClient, "request">;
    signal?: AbortSignal;
    now?: number;
    maxPages?: number;
  } = {},
): Promise<ContestRecord[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const maxPages = Math.max(
    1,
    Math.min(LUOGU_MAX_PAGES, Math.trunc(options.maxPages ?? LUOGU_MAX_PAGES)),
  );
  const contests: ContestRecord[] = [];
  let total = Number.POSITIVE_INFINITY;
  let perPage = 20;

  for (let page = 1; page <= maxPages && contests.length < total; page += 1) {
    const url =
      page === 1
        ? LUOGU_CONTEST_LIST_URL
        : `${LUOGU_CONTEST_LIST_URL}?page=${page}`;
    let html: string;
    try {
      html = options.http
        ? await requestTextWithClient("luogu", url, options.http, {
            credentials: "include",
            headers: {
              Accept: "application/json,text/html,application/xhtml+xml;q=0.9",
            },
            signal: options.signal,
          })
        : await requestText(
            "luogu",
            url,
            (input, init) =>
              fetchImpl(input, {
                ...init,
                signal: options.signal ?? init?.signal,
              }),
            {
              credentials: "include",
              redirect: "error",
              accept: "application/json,text/html,application/xhtml+xml;q=0.9",
            },
          );
    } catch (error) {
      if (error instanceof Error)
        throw new Error(`洛谷第 ${page} 页：${error.message}`, {
          cause: error,
        });
      throw error;
    }
    const parsed = parseLuoguContestPage(html, now);
    contests.push(...parsed.contests);
    total = parsed.total;
    perPage = parsed.perPage;

    // Pages are ordered newest-start first. Once a full page is older than
    // the end-time retention window, additional historical pages are unlikely
    // to qualify and are deliberately avoided. The global page cap remains a
    // guard against unusual source ordering or very dense contest schedules.
    if (
      parsed.sourceRowCount > 0 &&
      parsed.sourceRowCount >= perPage &&
      parsed.contests.every((contest) => {
        const endTime = endTimeOf(contest);
        return endTime !== undefined && endTime <= now - FINISHED_WINDOW_MS;
      })
    )
      break;
    if (parsed.sourceRowCount < perPage) break;
  }
  return deduplicateContests(contests);
}
