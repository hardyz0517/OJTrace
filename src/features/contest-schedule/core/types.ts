export const CONTEST_PLATFORMS = ["luogu", "codeforces", "atcoder"] as const;

export type ContestPlatform = (typeof CONTEST_PLATFORMS)[number];
export type ContestPhase = "upcoming" | "running" | "finished" | "unknown";
export type ContestPhaseFilter = ContestPhase | "all";

/** Increment when provider-normalized contest metadata changes incompatibly. */
export const CONTEST_DATA_VERSION = 1;

export interface ContestEvaluationInfo {
  /** Luogu RATED flag: counts toward its standard rating evaluation. */
  rating: boolean;
  /** Luogu ELO_RATED flag: counts toward its estimate/Elo evaluation. */
  estimate: boolean;
}

/** Normalized source data persisted between page visits. Times are epoch ms. */
export interface ContestRecord {
  id: string;
  platform: ContestPlatform;
  title: string;
  url: string;
  startTime: number;
  durationSeconds?: number;
  endTime?: number;
  /** Number of verified contest problems; absent means the source is unknown. */
  problemCount?: number;
  /** Normalized evaluation participation flags when the provider exposes them. */
  evaluation?: ContestEvaluationInfo;
  ratedRange?: string;
  sourcePhase?: string;
  fetchedAt: number;
}

/** A record with its phase recalculated against the current clock. */
export interface Contest extends ContestRecord {
  phase: ContestPhase;
  timingComplete: boolean;
}

export interface ContestCache {
  schemaVersion: 1;
  platform: ContestPlatform;
  contests: ContestRecord[];
  lastSuccessAt: number;
  contestDataVersion?: number;
  problemCountsCheckedAt?: number;
}

export type ContestProvider = (options?: {
  signal?: AbortSignal;
}) => Promise<ContestRecord[]>;

export type ContestProviderMap = Record<ContestPlatform, ContestProvider>;

export type ContestProblemCountProvider = (
  contestIds: readonly string[],
  options?: { signal?: AbortSignal },
) => Promise<ReadonlyMap<string, number>>;

export type ContestProblemCountProviderMap = Partial<
  Record<ContestPlatform, ContestProblemCountProvider>
>;

export interface ContestRefreshResult {
  platform: ContestPlatform;
  status: "success" | "failed" | "permission-required";
  message?: string;
  contestCount?: number;
}
