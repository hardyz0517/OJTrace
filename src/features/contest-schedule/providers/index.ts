import type {
  ContestProblemCountProviderMap,
  ContestProviderMap,
} from "../core/types";
import type { HttpClient } from "../../../domain/adapter";
import { fetchAtcoderContests } from "./atcoder/fetcher";
import { fetchCodeforcesContests } from "./codeforces/fetcher";
import { fetchLuoguContests } from "./luogu/fetcher";
import { createCodeforcesProblemCountProvider } from "./codeforces/problem-counts";
import { createAtcoderProblemCountProvider } from "./atcoder/problem-counts";

export interface ContestProviders {
  contests: ContestProviderMap;
  problemCounts: ContestProblemCountProviderMap;
}

export function createContestProviders(
  http: Pick<HttpClient, "request">,
): ContestProviders {
  return {
    contests: {
      luogu: () => fetchLuoguContests({ http }),
      codeforces: () => fetchCodeforcesContests(),
      atcoder: () => fetchAtcoderContests(),
    },
    problemCounts: {
      codeforces: createCodeforcesProblemCountProvider(),
      atcoder: createAtcoderProblemCountProvider(),
    },
  };
}
