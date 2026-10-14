const JOB_KEY_PREFIX = "ojtrace:problem-export:";
// Keep the hand-off token alive long enough for a newly created extension tab
// to wake the service worker and retry after a transient port disconnect.
// The value is still short-lived and is removed after the document is sent.
export const PROBLEM_EXPORT_JOB_TTL_MS = 5 * 60 * 1_000;
const claimedTokens = new Set<string>();

interface JobStorageArea {
  get(key: string | null): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
  remove(key: string | string[]): Promise<void>;
}

/**
 * `storage.session` is the normal hand-off area.  A short-lived local copy is
 * also kept as a compatibility fallback because reloading an unpacked MV3
 * extension clears session storage in some Chrome development workflows.
 */
function jobStorageAreas(): JobStorageArea[] {
  const storage = browser.storage as unknown as {
    session?: JobStorageArea;
    local?: JobStorageArea;
  };
  return [storage.session, storage.local].filter(
    (area): area is JobStorageArea => area !== undefined,
  );
}

async function setJob(key: string, job: ProblemExportJob): Promise<void> {
  const areas = jobStorageAreas();
  const results = await Promise.allSettled(
    areas.map((area) => area.set({ [key]: job })),
  );
  if (results.length === 0) {
    throw new Error("Problem export storage is unavailable");
  }
  if (results.every((result) => result.status === "rejected")) {
    throw (
      results.find((result) => result.status === "rejected")?.reason ??
      new Error("Problem export storage is unavailable")
    );
  }
}

async function removeJob(key: string): Promise<void> {
  const results = await Promise.allSettled(
    jobStorageAreas().map((area) => area.remove(key)),
  );
  if (
    results.length > 0 &&
    results.every((result) => result.status === "rejected")
  )
    throw results.find((result) => result.status === "rejected")?.reason;
}

export interface ProblemExportJob {
  token: string;
  tabId: number;
  expectedUrl: string;
  createdAt: number;
  expiresAt: number;
}

function keyFor(token: string): string {
  return `${JOB_KEY_PREFIX}${token}`;
}

export function isProblemExportJob(value: unknown): value is ProblemExportJob {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProblemExportJob>;
  return (
    typeof item.token === "string" &&
    item.token.length >= 12 &&
    typeof item.tabId === "number" &&
    Number.isInteger(item.tabId) &&
    item.tabId >= 0 &&
    typeof item.expectedUrl === "string" &&
    item.expectedUrl.length > 0 &&
    typeof item.createdAt === "number" &&
    Number.isFinite(item.createdAt) &&
    typeof item.expiresAt === "number" &&
    Number.isFinite(item.expiresAt) &&
    item.expiresAt > item.createdAt
  );
}

function newToken(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`.replaceAll("-", "");
}

export async function createProblemExportJob(input: {
  tabId: number;
  expectedUrl: string;
  now?: number;
  ttlMs?: number;
}): Promise<ProblemExportJob> {
  if (!Number.isInteger(input.tabId) || input.tabId < 0)
    throw new Error("Invalid export tab");
  const expectedUrl = input.expectedUrl.trim();
  if (!expectedUrl) throw new Error("Missing export URL");
  const createdAt = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? PROBLEM_EXPORT_JOB_TTL_MS;
  if (!Number.isFinite(createdAt) || !Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new Error("Invalid export expiration");
  await cleanupExpiredProblemExportJobs(createdAt);
  const job: ProblemExportJob = {
    token: newToken(),
    tabId: input.tabId,
    expectedUrl,
    createdAt,
    expiresAt: createdAt + ttlMs,
  };
  await setJob(keyFor(job.token), job);
  return job;
}

/** Read a job without deleting it. Expired jobs are eagerly removed. */
export async function readProblemExportJob(
  token: string,
  now = Date.now(),
): Promise<ProblemExportJob | undefined> {
  if (!token || token.length > 128) return undefined;
  const key = keyFor(token);
  for (const area of jobStorageAreas()) {
    let values: Record<string, unknown>;
    try {
      values = await area.get(key);
    } catch {
      continue;
    }
    const job = values[key];
    if (!isProblemExportJob(job)) {
      if (job !== undefined) await area.remove(key);
      continue;
    }
    if (job.expiresAt <= now) {
      await removeJob(key);
      return undefined;
    }
    return job;
  }
  return undefined;
}

export async function deleteProblemExportJob(token: string): Promise<void> {
  if (!token || token.length > 128) return;
  await removeJob(keyFor(token));
}

export async function consumeProblemExportJob(
  token: string,
  now = Date.now(),
): Promise<ProblemExportJob | undefined> {
  if (claimedTokens.has(token)) return undefined;
  claimedTokens.add(token);
  try {
    const job = await readProblemExportJob(token, now);
    if (!job) return undefined;
    await deleteProblemExportJob(token);
    return job;
  } finally {
    claimedTokens.delete(token);
  }
}

/** Remove malformed or expired short-lived jobs left by a closed export tab. */
export async function cleanupExpiredProblemExportJobs(
  now = Date.now(),
): Promise<void> {
  await Promise.all(
    jobStorageAreas().map(async (area) => {
      let values: Record<string, unknown>;
      try {
        values = await area.get(null);
      } catch {
        return;
      }
      const staleKeys = Object.entries(values)
        .filter(([key, value]) => {
          if (!key.startsWith(JOB_KEY_PREFIX)) return false;
          return !isProblemExportJob(value) || value.expiresAt <= now;
        })
        .map(([key]) => key);
      if (staleKeys.length > 0) await area.remove(staleKeys);
    }),
  );
}
