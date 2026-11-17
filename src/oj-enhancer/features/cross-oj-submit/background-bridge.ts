import {
  crossOjResponse,
  isCrossOjRecordListItem,
  isCrossOjMessage,
  type CrossOjMessage,
  type CrossOjResponse,
} from "./model";
import {
  fillCodeforcesFormInPage,
  inspectCodeforcesFormInPage,
} from "./codeforces-page";
import {
  fillAtCoderFormInPage,
  inspectAtCoderFormInPage,
} from "./atcoder-page";
import { CrossOjSubmitService } from "./service";
import type {
  CrossOjProblemRef,
  CrossOjRecordListItem,
  CrossOjSubmitTask,
  ProblemHistoryStatus,
} from "./model";
import { queryCodeforcesProblemHistoryStatus } from "./codeforces-problem-status";
import { queryAtCoderProblemHistoryStatus } from "./atcoder-problem-status";
import { queryCrossOjRecords } from "./cross-oj-records";
import {
  codeforcesUserStatusUrl,
  latestCodeforcesSubmissionId,
  lookupCodeforcesSubmission,
} from "./codeforces-submission-lookup";
import { parseAtCoderSessionHandle } from "./atcoder-session";
import { readLuoguEditorInPage } from "./luogu-editor";
import {
  parseLuoguProblemDifficultyFromHtml,
  normalizeLuoguProblemDifficulty,
  readLuoguPageProblemContextInPage,
} from "./luogu-page-context";
import {
  resolveLuoguProblem,
  sameLuoguPageDocumentUrl,
  sameLuoguProblem,
} from "./luogu-problem";
import { authorizedLuoguRecordListProblemId } from "./record-list-authorization";
import { RateLimitRegistry } from "../../../platform/network/rate-limit";

const LUOGU_PERMISSION = "https://www.luogu.com.cn/*";
const CODEFORCES_PERMISSION = "https://codeforces.com/*";
const ATCODER_PERMISSION = "https://atcoder.jp/*";
const CROSS_OJ_EXPIRY_ALARM_PREFIX = "ojtrace:cross-oj-submit:expire:";
const CROSS_OJ_HISTORY_KEY = "ojtrace:cross-oj-submit:history";
const LEGACY_DETAILS_SESSION_KEY = "ojtrace:cross-oj-submit:details";
const CROSS_OJ_RECORD_LIST_CACHE_INDEX_KEY =
  "ojtrace:cross-oj-submit:record-list-cache-v2:index";
const CROSS_OJ_RECORD_LIST_CACHE_PREFIX =
  "ojtrace:cross-oj-submit:record-list-cache-v2:entry:";
const CROSS_OJ_RECORD_LIST_CACHE_LIMIT = 12;
const OJTRACE_DATA_KEY = "ojtrace:data";
const CODEFORCES_API_MIN_INTERVAL_MS = 2_100;
const CODEFORCES_STATUS_TIMEOUT_MS = 8_000;
const ATCODER_API_MIN_INTERVAL_MS = 1_100;
const CROSS_OJ_PROBLEM_STATUS_CACHE_MS = 120_000;
const LUOGU_PROBLEM_DIFFICULTY_CACHE_MS = 30 * 60_000;
const LUOGU_PROBLEM_DIFFICULTY_FAILURE_COOLDOWN_MS = 60_000;
const LUOGU_PROBLEM_FETCH_TIMEOUT_MS = 8_000;
const LUOGU_PROBLEM_HTML_MAX_CHARS = 5_000_000;
const LUOGU_DIFFICULTY_SESSION_KEY =
  "ojtrace:cross-oj-submit:problem-difficulty-v1";
const LUOGU_DIFFICULTY_CACHE_LIMIT = 128;
const LUOGU_CONTENT_SCRIPT_PUBLIC_PATH =
  "content-scripts/luogu-cross-oj.js" as unknown as `/content-scripts/luogu-cross-oj.js`;
let codeforcesStatusQueue = Promise.resolve();
let codeforcesStatusLastRequestAt = 0;
let atcoderApiQueue = Promise.resolve();
let atcoderApiLastRequestAt = 0;
let atcoderSessionHandleCache:
  { handle: string | undefined; expiresAt: number } | undefined;
const codeforcesPageInFlight = new Map<string, Promise<unknown>>();
const atcoderPageInFlight = new Map<string, Promise<string>>();
let recordListCacheWriteQueue = Promise.resolve();
const remoteRecordQueryInFlight = new Map<
  string,
  Promise<{ records: CrossOjRecordListItem[]; message?: string }>
>();
const recordQueryRateLimits = new RateLimitRegistry({
  now: () => Date.now(),
  storage: {
    async load() {
      const stored = await browser.storage.session.get(
        "ojtrace:cross-oj-submit:rate-limits",
      );
      const entries = stored["ojtrace:cross-oj-submit:rate-limits"];
      return Array.isArray(entries) ? entries : undefined;
    },
    async save(entries) {
      await browser.storage.session.set({
        "ojtrace:cross-oj-submit:rate-limits": entries,
      });
    },
  },
});
interface ProblemStatusResult {
  status: ProblemHistoryStatus;
  message?: string;
}
const problemStatusCache = new Map<
  string,
  { expiresAt: number; result: ProblemStatusResult }
>();
const problemStatusInFlight = new Map<string, Promise<ProblemStatusResult>>();
const luoguProblemDifficultyCache = new Map<
  string,
  { difficulty: number | undefined; expiresAt: number }
>();
const luoguProblemDifficultyInFlight = new Map<
  string,
  Promise<LuoguDifficultyResult>
>();
interface LuoguDifficultyResult {
  difficulty?: number;
  retryAt?: number;
}
let difficultyCacheReady: Promise<void> | undefined;
let difficultyCacheWriteQueue = Promise.resolve();
interface CrossOjRecordListCacheEntry {
  cursors: Record<string, number>;
  scanOffsets: Record<string, number>;
  records: CrossOjRecordListItem[];
}

function recordListCacheKey(
  problem: CrossOjProblemRef,
  handles: readonly string[],
): string {
  return JSON.stringify([
    problem.oj,
    problem.contestId.toLowerCase(),
    problem.oj === "codeforces"
      ? problem.index.toUpperCase()
      : problem.taskId.toLowerCase(),
    ...[...new Set(handles.map((handle) => handle.toLowerCase()))].sort(),
  ]);
}

function recordListCacheStorageKey(cacheKey: string): string {
  return `${CROSS_OJ_RECORD_LIST_CACHE_PREFIX}${encodeURIComponent(cacheKey)}`;
}

function parseRecordListCacheEntry(
  entry: unknown,
): CrossOjRecordListCacheEntry | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    return undefined;
  const value = entry as Partial<CrossOjRecordListCacheEntry>;
  if (
    !Array.isArray(value.records) ||
    !value.records.every(isCrossOjRecordListItem) ||
    !value.cursors ||
    typeof value.cursors !== "object" ||
    Array.isArray(value.cursors)
  )
    return undefined;
  const cursors = Object.fromEntries(
    Object.entries(value.cursors).filter(
      ([handle, cursor]) =>
        /^[a-z0-9_.-]{1,32}$/i.test(handle) &&
        typeof cursor === "number" &&
        Number.isSafeInteger(cursor) &&
        cursor >= 0,
    ),
  ) as Record<string, number>;
  const scanOffsets = Object.fromEntries(
    Object.entries(
      value.scanOffsets && typeof value.scanOffsets === "object"
        ? value.scanOffsets
        : {},
    ).filter(
      ([handle, offset]) =>
        /^[a-z0-9_.-]{1,32}$/i.test(handle) &&
        typeof offset === "number" &&
        Number.isSafeInteger(offset) &&
        offset >= 0,
    ),
  ) as Record<string, number>;
  return {
    cursors,
    scanOffsets,
    records: value.records.slice(0, 1000),
  };
}

async function readRecordListCache(
  cacheKey: string,
): Promise<CrossOjRecordListCacheEntry | undefined> {
  const storageKey = recordListCacheStorageKey(cacheKey);
  const stored = await browser.storage.session.get(storageKey);
  return parseRecordListCacheEntry(stored[storageKey]);
}

async function writeRecordListCache(
  cacheKey: string,
  entry: CrossOjRecordListCacheEntry,
): Promise<void> {
  const write = recordListCacheWriteQueue.then(async () => {
    const storageKey = recordListCacheStorageKey(cacheKey);
    const storedEntry = await browser.storage.session.get(storageKey);
    const previousEntry = parseRecordListCacheEntry(storedEntry[storageKey]);
    if (previousEntry) {
      const cursors = { ...previousEntry.cursors, ...entry.cursors };
      for (const [handle, cursor] of Object.entries(cursors))
        cursors[handle] = Math.max(previousEntry.cursors[handle] ?? 0, cursor);
      entry = {
        cursors,
        scanOffsets: { ...previousEntry.scanOffsets, ...entry.scanOffsets },
        records: mergeRecordList(previousEntry.records, entry.records),
      };
    }
    const rawIndex = (
      await browser.storage.session.get(CROSS_OJ_RECORD_LIST_CACHE_INDEX_KEY)
    )[CROSS_OJ_RECORD_LIST_CACHE_INDEX_KEY];
    const index = Array.isArray(rawIndex)
      ? [...new Set(rawIndex)].filter(
          (key): key is string =>
            typeof key === "string" &&
            key.startsWith(CROSS_OJ_RECORD_LIST_CACHE_PREFIX),
        )
      : [];
    const nextIndex = [
      storageKey,
      ...index.filter((key) => key !== storageKey),
    ].slice(0, CROSS_OJ_RECORD_LIST_CACHE_LIMIT);
    const evicted = index.filter((key) => !nextIndex.includes(key));
    await browser.storage.session.set({
      [storageKey]: entry,
      [CROSS_OJ_RECORD_LIST_CACHE_INDEX_KEY]: nextIndex,
    });
    if (evicted.length) await browser.storage.session.remove(evicted);
  });
  recordListCacheWriteQueue = write.catch(() => undefined);
  await write;
}

async function clearRecordListCache(): Promise<void> {
  const clear = recordListCacheWriteQueue.then(async () => {
    const rawIndex = (
      await browser.storage.session.get(CROSS_OJ_RECORD_LIST_CACHE_INDEX_KEY)
    )[CROSS_OJ_RECORD_LIST_CACHE_INDEX_KEY];
    const keys = Array.isArray(rawIndex)
      ? rawIndex.filter(
          (key): key is string =>
            typeof key === "string" &&
            key.startsWith(CROSS_OJ_RECORD_LIST_CACHE_PREFIX),
        )
      : [];
    await browser.storage.session.remove([
      CROSS_OJ_RECORD_LIST_CACHE_INDEX_KEY,
      ...keys,
    ]);
  });
  recordListCacheWriteQueue = clear.catch(() => undefined);
  await clear;
}

function mergeRecordList(
  cached: readonly CrossOjRecordListItem[],
  updated: readonly CrossOjRecordListItem[],
): CrossOjRecordListItem[] {
  const records = new Map<string, CrossOjRecordListItem>();
  for (const record of cached)
    records.set(`${record.oj}:${record.submissionId}`, record);
  for (const record of updated) {
    const key = `${record.oj}:${record.submissionId}`;
    const previous = records.get(key);
    if (!previous || record.statusUpdatedAt >= previous.statusUpdatedAt)
      records.set(key, record);
  }
  return [...records.values()]
    .sort((left, right) => right.observedAt - left.observedAt)
    .slice(0, 1000);
}

function assertRecordQueryAvailable(origin: string): void {
  const remaining = recordQueryRateLimits.getRetryAfterMs(origin);
  if (remaining > 0)
    throw new Error(
      `原站限制了请求频率，请在 ${Math.ceil(remaining / 1000)} 秒后刷新。`,
    );
}

function requestCodeforcesStatusPage(url: string): Promise<unknown> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.reject(new Error("Invalid Codeforces API URL."));
  }
  if (
    parsed.origin !== "https://codeforces.com" ||
    (parsed.pathname !== "/api/user.status" &&
      parsed.pathname !== "/api/contest.status")
  )
    return Promise.reject(new Error("Invalid Codeforces API URL."));
  const existing = codeforcesPageInFlight.get(url);
  if (existing) return existing;
  const operation = codeforcesStatusQueue.then(async () => {
    await recordQueryRateLimits.ready();
    assertRecordQueryAvailable(parsed.origin);
    const wait = Math.max(
      0,
      CODEFORCES_API_MIN_INTERVAL_MS -
        (Date.now() - codeforcesStatusLastRequestAt),
    );
    if (wait > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    assertRecordQueryAvailable(parsed.origin);
    codeforcesStatusLastRequestAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CODEFORCES_STATUS_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 429) {
        recordQueryRateLimits.record429(
          parsed.origin,
          response.headers.get("Retry-After"),
        );
        assertRecordQueryAvailable(parsed.origin);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    } finally {
      clearTimeout(timeout);
    }
  });
  const tracked = operation.finally(() => {
    codeforcesPageInFlight.delete(url);
  });
  codeforcesPageInFlight.set(url, tracked);
  codeforcesStatusQueue = tracked.then(
    () => undefined,
    () => undefined,
  );
  return tracked;
}

function configuredHandlesForSource(
  source: "codeforces" | "atcoder",
  stored: Record<string, unknown>,
): string[] {
  const data = stored[OJTRACE_DATA_KEY];
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const accounts = (data as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts
    .filter(
      (account): account is Record<string, unknown> =>
        !!account && typeof account === "object" && !Array.isArray(account),
    )
    .filter((account) => account.source === source && account.enabled === true)
    .map((account) =>
      typeof account.providerAccountKey === "string"
        ? account.providerAccountKey
        : typeof account.identifier === "string"
          ? account.identifier
          : "",
    )
    .filter((handle) => handle.length > 0);
}

async function enabledHandlesForSource(
  source: "codeforces" | "atcoder",
): Promise<string[]> {
  const stored = await browser.storage.local.get(OJTRACE_DATA_KEY);
  const configured = configuredHandlesForSource(source, stored);
  if (source !== "atcoder") return configured;
  const sessionHandle = await requestAtCoderSessionHandle();
  // Direct official-page queries must follow the browser's logged-in account.
  // Keep configured handles as a fallback for public/non-session use.
  return sessionHandle ? [sessionHandle] : configured;
}

async function requestAtCoderSessionHandle(): Promise<string | undefined> {
  if (
    atcoderSessionHandleCache &&
    atcoderSessionHandleCache.expiresAt > Date.now()
  )
    return atcoderSessionHandleCache.handle;
  try {
    const html = await requestAtCoderHtmlPage("https://atcoder.jp/home");
    const handle = parseAtCoderSessionHandle(html);
    // Cache a missing handle too: logged-out pages or changed home markup
    // should not make each Luogu problem visit fetch /home again.
    atcoderSessionHandleCache = { handle, expiresAt: Date.now() + 30_000 };
    return handle;
  } catch {
    atcoderSessionHandleCache = {
      handle: undefined,
      expiresAt: Date.now() + 30_000,
    };
    return undefined;
  }
}

function requestAtCoderHtmlPage(url: string): Promise<string> {
  const existing = atcoderPageInFlight.get(url);
  if (existing) return existing;
  const operation = atcoderApiQueue.then(async () => {
    await recordQueryRateLimits.ready();
    assertRecordQueryAvailable("https://atcoder.jp");
    const wait = Math.max(
      0,
      ATCODER_API_MIN_INTERVAL_MS - (Date.now() - atcoderApiLastRequestAt),
    );
    if (wait > 0)
      await new Promise<void>((resolve) => setTimeout(resolve, wait));
    assertRecordQueryAvailable("https://atcoder.jp");
    atcoderApiLastRequestAt = Date.now();
    const parsed = new URL(url);
    if (
      parsed.origin !== "https://atcoder.jp" ||
      !(
        /^\/home\/?$/i.test(parsed.pathname) ||
        /^\/contests\/[^/]+\/submissions\/?$/i.test(parsed.pathname)
      )
    )
      throw new Error("Invalid AtCoder official URL.");
    const response = await fetch(parsed.href, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "text/html" },
    });
    if (response.status === 429) {
      recordQueryRateLimits.record429(
        parsed.origin,
        response.headers.get("Retry-After"),
      );
      assertRecordQueryAvailable(parsed.origin);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const responseUrl = new URL(response.url);
    if (/^\/login(?:\/|$)/i.test(responseUrl.pathname))
      throw new Error("AtCoder 登录态已失效，请先在 AtCoder 登录。");
    if (responseUrl.origin !== "https://atcoder.jp")
      throw new Error("AtCoder 返回了非官方页面。");
    return response.text();
  });
  const tracked = operation.finally(() => {
    atcoderPageInFlight.delete(url);
  });
  atcoderPageInFlight.set(url, tracked);
  atcoderApiQueue = tracked.then(
    () => undefined,
    () => undefined,
  );
  return tracked;
}

function requestAtCoderSubmissionsPage(url: string): Promise<unknown> {
  return requestAtCoderHtmlPage(url);
}

function loadDifficultyCache(): Promise<void> {
  difficultyCacheReady ??= (async () => {
    try {
      const stored = (
        await browser.storage.session.get(LUOGU_DIFFICULTY_SESSION_KEY)
      )[LUOGU_DIFFICULTY_SESSION_KEY];
      if (!Array.isArray(stored)) return;
      for (const entry of stored.slice(-LUOGU_DIFFICULTY_CACHE_LIMIT)) {
        if (
          !entry ||
          typeof entry !== "object" ||
          typeof entry.problemId !== "string" ||
          !/^[a-z0-9_-]{1,100}$/i.test(entry.problemId) ||
          normalizeLuoguProblemDifficulty(entry.difficulty) === undefined ||
          !Number.isSafeInteger(entry.expiresAt) ||
          entry.expiresAt < 0
        )
          continue;
        luoguProblemDifficultyCache.set(entry.problemId.toUpperCase(), {
          difficulty: entry.difficulty,
          expiresAt: entry.expiresAt,
        });
      }
    } catch {
      // Public metadata can still be fetched if session storage is unavailable.
    }
  })();
  return difficultyCacheReady;
}

function persistDifficultyCache(): Promise<void> {
  difficultyCacheWriteQueue = difficultyCacheWriteQueue.then(async () => {
    const entries = [...luoguProblemDifficultyCache]
      .flatMap(([problemId, entry]) =>
        entry.difficulty === undefined ? [] : [{ problemId, ...entry }],
      )
      .slice(-LUOGU_DIFFICULTY_CACHE_LIMIT);
    try {
      await browser.storage.session.set({
        [LUOGU_DIFFICULTY_SESSION_KEY]: entries,
      });
    } catch {
      // Keep successful metadata in memory when session storage is unavailable.
    }
  });
  return difficultyCacheWriteQueue;
}

async function fetchLuoguProblemDifficulty(
  problemId: string,
): Promise<number | undefined> {
  if (!browser.permissions?.contains) return undefined;
  try {
    if (!(await browser.permissions.contains({ origins: [LUOGU_PERMISSION] })))
      return undefined;
  } catch {
    return undefined;
  }

  await recordQueryRateLimits.ready();
  recordQueryRateLimits.assertAvailable("https://www.luogu.com.cn");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LUOGU_PROBLEM_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await fetch(
      `https://www.luogu.com.cn/problem/${encodeURIComponent(problemId)}`,
      {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "text/html" },
        signal: controller.signal,
      },
    );
    if (response.status === 429) {
      recordQueryRateLimits.record429(
        "https://www.luogu.com.cn",
        response.headers.get("Retry-After"),
      );
    }
    if (!response.ok) return undefined;
    const responseUrl = new URL(response.url);
    if (
      responseUrl.origin !== "https://www.luogu.com.cn" ||
      !/^\/problem\/[^/]+\/?$/i.test(responseUrl.pathname)
    )
      return undefined;
    const html = await response.text();
    if (html.length > LUOGU_PROBLEM_HTML_MAX_CHARS) return undefined;
    return parseLuoguProblemDifficultyFromHtml(html, problemId);
  } finally {
    clearTimeout(timeout);
  }
}

async function luoguProblemDifficulty(
  problemId: string,
): Promise<LuoguDifficultyResult> {
  await loadDifficultyCache();
  await recordQueryRateLimits.ready();
  const key = problemId.toUpperCase();
  const cached = luoguProblemDifficultyCache.get(key);
  const retryAt = Math.max(
    cached?.expiresAt ?? 0,
    Date.now() +
      recordQueryRateLimits.getRetryAfterMs("https://www.luogu.com.cn"),
  );
  if (retryAt > Date.now())
    return cached?.difficulty !== undefined
      ? { difficulty: cached.difficulty }
      : { retryAt };
  const running = luoguProblemDifficultyInFlight.get(key);
  if (running) return running;

  const operation = (async (): Promise<LuoguDifficultyResult> => {
    let fetchedDifficulty: number | undefined;
    try {
      fetchedDifficulty = await fetchLuoguProblemDifficulty(problemId);
    } catch {
      // A transient failure must not discard a successful cached value.
    }
    const difficulty = fetchedDifficulty ?? cached?.difficulty;
    const expiresAt =
      Date.now() +
      (fetchedDifficulty === undefined
        ? Math.max(
            LUOGU_PROBLEM_DIFFICULTY_FAILURE_COOLDOWN_MS,
            recordQueryRateLimits.getRetryAfterMs("https://www.luogu.com.cn"),
          )
        : LUOGU_PROBLEM_DIFFICULTY_CACHE_MS);
    luoguProblemDifficultyCache.delete(key);
    luoguProblemDifficultyCache.set(key, {
      difficulty,
      expiresAt,
    });
    while (luoguProblemDifficultyCache.size > LUOGU_DIFFICULTY_CACHE_LIMIT) {
      const oldest = luoguProblemDifficultyCache.keys().next().value;
      if (oldest === undefined) break;
      luoguProblemDifficultyCache.delete(oldest);
    }
    if (fetchedDifficulty !== undefined) await persistDifficultyCache();
    return difficulty === undefined ? { retryAt: expiresAt } : { difficulty };
  })();
  luoguProblemDifficultyInFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    luoguProblemDifficultyInFlight.delete(key);
  }
}

async function queryRemoteRecordsUncached(
  problem: CrossOjProblemRef,
  handles: readonly string[],
  cache: CrossOjRecordListCacheEntry | undefined,
  continueScan = false,
): Promise<{
  records: CrossOjRecordListItem[];
  message?: string;
  recordScanHasMore?: boolean;
}> {
  if (!handles.length)
    return {
      records: [],
      message: "请先在 OJTrace 中配置并启用对应 OJ 账号。",
    };
  const permission =
    problem.oj === "codeforces" ? CODEFORCES_PERMISSION : ATCODER_PERMISSION;
  if (!(await browser.permissions.contains({ origins: [permission] })))
    return {
      records: cache?.records ?? [],
      message:
        problem.oj === "codeforces"
          ? "未授予 Codeforces 站点权限，无法读取提交记录。"
          : "未授予 AtCoder 站点权限，无法读取提交记录。",
    };
  const result = await queryCrossOjRecords({
    handles,
    problem,
    requestPage:
      problem.oj === "codeforces"
        ? requestCodeforcesStatusPage
        : requestAtCoderSubmissionsPage,
    ...(cache && { cursors: cache.cursors, cachedRecords: cache.records }),
    ...(cache && { scanOffsets: cache.scanOffsets }),
    continueScan,
    pageBudget: 1,
  });
  const records = mergeRecordList(cache?.records ?? [], result.records);
  await writeRecordListCache(recordListCacheKey(problem, handles), {
    cursors: { ...cache?.cursors, ...result.cursors },
    scanOffsets: { ...cache?.scanOffsets, ...result.scanOffsets },
    records,
  });
  return {
    records,
    ...(result.message ? { message: result.message } : {}),
    ...(result.hasMore ? { recordScanHasMore: true } : {}),
  };
}

/** Share concurrent queries while each later refresh checks for new records. */
async function queryRemoteRecords(
  problem: CrossOjProblemRef,
  handles: readonly string[],
  cache: CrossOjRecordListCacheEntry | undefined,
  continueScan = false,
): Promise<{
  records: CrossOjRecordListItem[];
  message?: string;
  recordScanHasMore?: boolean;
}> {
  const key = recordListCacheKey(problem, handles);
  const running = remoteRecordQueryInFlight.get(key);
  if (running) return running;

  const operation = queryRemoteRecordsUncached(
    problem,
    handles,
    cache,
    continueScan,
  );
  remoteRecordQueryInFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    remoteRecordQueryInFlight.delete(key);
  }
}

async function queryProblemStatus(
  source: "codeforces" | "atcoder",
  problem: CrossOjProblemRef,
  handles: readonly string[],
): Promise<ProblemStatusResult> {
  const key = JSON.stringify([
    source,
    problem,
    [...new Set(handles.map((handle) => handle.trim().toLowerCase()))].sort(),
  ]);
  const now = Date.now();
  const cached = problemStatusCache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;
  const running = problemStatusInFlight.get(key);
  if (running) return running;

  const operation =
    source === "codeforces"
      ? queryCodeforcesProblemHistoryStatus({
          handles,
          problem: problem as Extract<CrossOjProblemRef, { oj: "codeforces" }>,
          requestPage: requestCodeforcesStatusPage,
        })
      : queryAtCoderProblemHistoryStatus({
          handles,
          problem: problem as Extract<CrossOjProblemRef, { oj: "atcoder" }>,
          requestPage: requestAtCoderSubmissionsPage,
        });
  problemStatusInFlight.set(key, operation);
  try {
    const result = await operation;
    problemStatusCache.set(key, {
      expiresAt: Date.now() + CROSS_OJ_PROBLEM_STATUS_CACHE_MS,
      result,
    });
    for (const [cachedKey, entry] of problemStatusCache) {
      if (entry.expiresAt <= Date.now()) problemStatusCache.delete(cachedKey);
    }
    while (problemStatusCache.size > 256) {
      const oldestKey = problemStatusCache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      problemStatusCache.delete(oldestKey);
    }
    return result;
  } finally {
    problemStatusInFlight.delete(key);
  }
}

async function authorizedRecordListPage(
  sender: {
    id?: string;
    url?: string;
    frameId?: number;
    tab?: { id?: number };
  },
  problem: CrossOjProblemRef,
  claimedPageUrl?: string,
): Promise<"unauthorized-sender" | "page-url-changed" | { problemId: string }> {
  if (!isLuoguPageSender(sender) || typeof sender.tab?.id !== "number")
    return "unauthorized-sender";
  const sourceTab = await browser.tabs.get(sender.tab.id);
  const problemId =
    typeof sender.url === "string"
      ? authorizedLuoguRecordListProblemId(
          sender.url,
          sourceTab.url ?? "",
          problem,
          claimedPageUrl,
        )
      : undefined;
  return problemId ? { problemId } : "page-url-changed";
}

export async function clearCrossOjHistory(): Promise<void> {
  await service.clearHistory();
  await browser.storage.session.remove([LEGACY_DETAILS_SESSION_KEY]);
  await clearRecordListCache();
  problemStatusCache.clear();
}

const service = new CrossOjSubmitService({
  storage: {
    async get(key) {
      const stored = await browser.storage.session.get(key);
      const task = stored[key];
      return task && typeof task === "object"
        ? (task as CrossOjSubmitTask)
        : undefined;
    },
    async set(key, task) {
      await browser.storage.session.set({ [key]: task });
    },
    async remove(key) {
      await browser.storage.session.remove(key);
    },
    async getAll() {
      return browser.storage.session.get(null);
    },
  },
  tabs: {
    async get(tabId) {
      const tab = await browser.tabs.get(tabId);
      return { id: tab.id, url: tab.url };
    },
    async create(properties) {
      const tab = await browser.tabs.create(properties);
      return { id: tab.id };
    },
    async update(tabId, properties) {
      return browser.tabs.update(tabId, properties);
    },
    async remove(tabId) {
      await browser.tabs.remove(tabId);
    },
  },
  adapter: {
    async inspect(task) {
      const result =
        task.problem.oj === "codeforces"
          ? await browser.scripting.executeScript({
              target: { tabId: task.targetTabId },
              world: "MAIN",
              func: inspectCodeforcesFormInPage,
            })
          : await browser.scripting.executeScript({
              target: { tabId: task.targetTabId },
              world: "MAIN",
              func: inspectAtCoderFormInPage,
              args: [{ problem: task.problem }],
            });
      const inspection = result[0]?.result;
      return inspection?.status === "ready"
        ? { ...inspection, documentId: result[0]?.documentId }
        : (inspection ?? { status: "form-unavailable" as const });
    },
    async fill(task, languageValue, documentId) {
      const target = documentId
        ? { tabId: task.targetTabId, documentIds: [documentId] }
        : { tabId: task.targetTabId };
      const result =
        task.problem.oj === "codeforces"
          ? await browser.scripting.executeScript({
              target,
              world: "MAIN",
              func: fillCodeforcesFormInPage,
              args: [
                {
                  problem: task.problem,
                  code: task.editor?.code ?? "",
                  languageValue,
                  submit: true,
                },
              ],
            })
          : await browser.scripting.executeScript({
              target,
              world: "MAIN",
              func: fillAtCoderFormInPage,
              args: [
                {
                  problem: task.problem,
                  code: task.editor?.code ?? "",
                  languageValue,
                  submit: true,
                },
              ],
            });
      return (
        result[0]?.result ??
        (task.problem.oj === "codeforces"
          ? { status: "submit-uncertain" as const }
          : { status: "changed" as const })
      );
    },
    async captureCodeforcesBaseline(task, handle) {
      if (task.problem.oj !== "codeforces") return undefined;
      const url = codeforcesUserStatusUrl(handle, 1);
      if (!url) return undefined;
      return latestCodeforcesSubmissionId(
        await requestCodeforcesStatusPage(url),
      );
    },
    async findCodeforcesSubmission(task) {
      if (
        task.problem.oj !== "codeforces" ||
        !task.codeforcesHandle ||
        !task.codeforcesBaselineSubmissionId ||
        task.submitObservedAt === undefined
      )
        return { status: "unavailable" as const };
      const url = codeforcesUserStatusUrl(task.codeforcesHandle, 100);
      if (!url) return { status: "unavailable" as const };
      return lookupCodeforcesSubmission(
        await requestCodeforcesStatusPage(url),
        {
          problem: task.problem,
          handle: task.codeforcesHandle,
          baselineSubmissionId: task.codeforcesBaselineSubmissionId,
          submitObservedAt: task.submitObservedAt,
        },
      );
    },
  },
  history: {
    async get() {
      return (await browser.storage.local.get(CROSS_OJ_HISTORY_KEY))[
        CROSS_OJ_HISTORY_KEY
      ];
    },
    async set(records) {
      await browser.storage.local.set({ [CROSS_OJ_HISTORY_KEY]: records });
    },
  },
  hasPermissions: (problem) =>
    browser.permissions.contains({
      origins: [
        LUOGU_PERMISSION,
        problem.oj === "codeforces"
          ? CODEFORCES_PERMISSION
          : ATCODER_PERMISSION,
      ],
    }),
  async scheduleExpiration(tabId, expiresAt) {
    await browser.alarms.create(`${CROSS_OJ_EXPIRY_ALARM_PREFIX}${tabId}`, {
      when: expiresAt,
    });
  },
  async clearExpiration(tabId) {
    await browser.alarms.clear(`${CROSS_OJ_EXPIRY_ALARM_PREFIX}${tabId}`);
  },
});

export function registerCrossOjSubmitBackground(): void {
  // Remove source/test snapshots retained by versions with embedded details.
  void Promise.resolve()
    .then(() => browser.storage.session.remove(LEGACY_DETAILS_SESSION_KEY))
    .catch(() => {});
  void bootstrapLuoguPageIntegration();
  void service.cleanupExpired().then(() => service.rearmExpirations());
  browser.alarms?.onAlarm?.addListener((alarm) => {
    if (!alarm.name.startsWith(CROSS_OJ_EXPIRY_ALARM_PREFIX)) return;
    const tabId = Number(alarm.name.slice(CROSS_OJ_EXPIRY_ALARM_PREFIX.length));
    if (Number.isInteger(tabId) && tabId >= 0) void service.expire(tabId);
  });
  browser.tabs?.onRemoved?.addListener((tabId) => {
    void service.onTabRemoved(tabId);
  });
  browser.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void service.onTabUrlUpdated(tabId, changeInfo.url);
  });
}

/** Injects the manifest-declared scripts into tabs opened before install or reload. */
async function bootstrapLuoguPageIntegration(): Promise<void> {
  if (!browser.permissions?.contains || !browser.scripting?.executeScript)
    return;
  let granted = false;
  try {
    granted = await browser.permissions.contains({
      origins: [LUOGU_PERMISSION],
    });
  } catch {
    return;
  }
  if (!granted) return;
  try {
    const tabs = await browser.tabs.query({
      url: "https://www.luogu.com.cn/*",
    });
    await Promise.all(
      tabs.map(async (candidate) => {
        if (typeof candidate.id !== "number") return;
        try {
          const tab = await browser.tabs.get(candidate.id);
          if (
            !tab.url ||
            new URL(tab.url).origin !== "https://www.luogu.com.cn"
          )
            return;
          await browser.scripting.executeScript({
            target: { tabId: candidate.id },
            files: [LUOGU_CONTENT_SCRIPT_PUBLIC_PATH],
          });
        } catch {
          // Ignore tabs that close or navigate during the bootstrap.
        }
      }),
    );
  } catch {
    // The page integration is optional; the popup and target adapters remain usable.
  }
}

function isLuoguPageSender(sender: {
  url?: string;
  frameId?: number;
  tab?: { id?: number };
}): sender is { url: string; frameId: number; tab: { id: number } } {
  if (
    sender.frameId !== 0 ||
    typeof sender.tab?.id !== "number" ||
    typeof sender.url !== "string"
  )
    return false;
  try {
    return new URL(sender.url).origin === "https://www.luogu.com.cn";
  } catch {
    return false;
  }
}

async function resolveLuoguProblemInTab(
  tabId: number,
  expectedUrl: string,
): Promise<CrossOjProblemRef | undefined> {
  const tab = await browser.tabs.get(tabId);
  if (!tab.url || !sameLuoguPageDocumentUrl(tab.url, expectedUrl))
    return undefined;
  const result = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: readLuoguPageProblemContextInPage,
  });
  const context = result[0]?.result;
  return resolveLuoguProblem(tab.url, context)?.problem;
}

export async function handleCrossOjSubmitMessage(
  raw: unknown,
  sender: {
    id?: string;
    url?: string;
    frameId?: number;
    tab?: { id?: number };
  },
): Promise<CrossOjResponse | undefined> {
  if (!isCrossOjMessage(raw)) return undefined;
  const message: CrossOjMessage = raw;
  if (sender.id !== browser.runtime.id)
    return crossOjResponse(message.requestId, false, "unauthorized-sender");
  try {
    if (message.type === "CAPTURE_CROSS_OJ_EDITOR") {
      if (!isLuoguPageSender(sender))
        return crossOjResponse(message.requestId, false, "unauthorized-sender");
      const sourceTab = await browser.tabs.get(sender.tab.id);
      if (
        !sourceTab.url ||
        !sameLuoguPageDocumentUrl(sourceTab.url, sender.url)
      )
        return crossOjResponse(message.requestId, false, "tab-changed");
      const result = await browser.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: "MAIN",
        func: readLuoguEditorInPage,
      });
      const captured = result[0]?.result;
      if (!captured || typeof captured !== "object" || !captured.ok) {
        const code = captured?.reason ?? "editor-unavailable";
        return crossOjResponse(message.requestId, false, code, {
          message:
            code === "empty-code"
              ? "洛谷编辑器中的代码为空。"
              : code === "language-unavailable"
                ? "无法唯一确认洛谷当前语言，请确认语言选择器已加载。"
                : "无法定位洛谷当前代码编辑器。请确认正在“提交代码”页，再刷新页面后重试。",
        });
      }
      if (
        typeof captured.code !== "string" ||
        !captured.code.trim() ||
        captured.code.length > 256_000 ||
        typeof captured.language !== "string" ||
        !captured.language.trim() ||
        captured.language.length > 120 ||
        typeof captured.editorKind !== "string" ||
        captured.editorKind.length > 80
      )
        return crossOjResponse(message.requestId, false, "invalid-editor");
      return crossOjResponse(message.requestId, true, "editor-captured", {
        editor: {
          code: captured.code,
          luoguLanguage: captured.language,
          editorKind: captured.editorKind,
          capturedAt: Date.now(),
        },
      });
    }
    if (message.type === "CHECK_CROSS_OJ_PAGE_ACCESS") {
      if (!isLuoguPageSender(sender))
        return crossOjResponse(message.requestId, false, "unauthorized-sender");
      const sourceTab = await browser.tabs.get(sender.tab.id);
      if (
        !sourceTab.url ||
        !sameLuoguPageDocumentUrl(sourceTab.url, sender.url)
      )
        return crossOjResponse(message.requestId, false, "page-url-changed");
      const parsed = await resolveLuoguProblemInTab(sender.tab.id, sender.url);
      if (!sameLuoguProblem(parsed, message.problem))
        return crossOjResponse(message.requestId, false, "problem-mismatch");
      const targetPermission =
        message.problem.oj === "codeforces"
          ? CODEFORCES_PERMISSION
          : ATCODER_PERMISSION;
      const allowed = await browser.permissions.contains({
        origins: [LUOGU_PERMISSION, targetPermission],
      });
      return crossOjResponse(
        message.requestId,
        true,
        allowed ? "page-access-allowed" : "page-access-required",
      );
    }
    if (message.type === "CREATE_CROSS_OJ_TASK") {
      const extensionBase = browser.runtime.getURL("/");
      const fromExtension = sender.url?.startsWith(extensionBase) ?? false;
      const fromLuogu = isLuoguPageSender(sender);
      if (!fromExtension && !fromLuogu)
        return crossOjResponse(message.requestId, false, "unauthorized-sender");
      const sourceTabId = fromLuogu ? sender.tab.id : message.sourceTabId;
      const sourceUrl = fromLuogu ? sender.url : message.sourceUrl;
      if (typeof sourceTabId !== "number" || typeof sourceUrl !== "string")
        return crossOjResponse(message.requestId, false, "invalid-source");
      const sourceProblem = await resolveLuoguProblemInTab(
        sourceTabId,
        sourceUrl,
      );
      if (!sameLuoguProblem(sourceProblem, message.problem))
        return crossOjResponse(message.requestId, false, "problem-mismatch");
      const created = await service.create({
        sourceTabId,
        sourceUrl,
        problem: message.problem,
        editor: message.editor,
      });
      return crossOjResponse(message.requestId, true, "opened", {
        targetTabId: created.targetTabId,
        targetUrl: created.targetUrl,
      });
    }
    if (message.type === "GET_CROSS_OJ_PROBLEM_DIFFICULTY") {
      const authorization = await authorizedRecordListPage(
        sender,
        message.problem,
        message.pageUrl,
      );
      if (typeof authorization === "string")
        return crossOjResponse(message.requestId, false, authorization);
      const metadata = await luoguProblemDifficulty(authorization.problemId);
      return crossOjResponse(
        message.requestId,
        true,
        "problem-difficulty-loaded",
        {
          ...(metadata.difficulty === undefined
            ? {}
            : { problemDifficulty: metadata.difficulty }),
          ...(metadata.retryAt === undefined
            ? {}
            : { problemDifficultyRetryAt: metadata.retryAt }),
        },
      );
    }
    if (message.type === "GET_CROSS_OJ_RECORDS") {
      const authorizationError = await authorizedRecordListPage(
        sender,
        message.problem,
        message.pageUrl,
      );
      if (typeof authorizationError === "string")
        return crossOjResponse(message.requestId, false, authorizationError, {
          message: "记录列表已切换或题目不匹配，请刷新后重试。",
        });
      const handles = await enabledHandlesForSource(message.problem.oj);
      const cache = await readRecordListCache(
        recordListCacheKey(message.problem, handles),
      );
      const problemDifficulty = luoguProblemDifficultyCache.get(
        authorizationError.problemId.toUpperCase(),
      )?.difficulty;
      return crossOjResponse(message.requestId, true, "records-loaded", {
        records: cache?.records ?? [],
        ...(problemDifficulty !== undefined ? { problemDifficulty } : {}),
        ...(Object.values(cache?.scanOffsets ?? {}).some((offset) => offset > 0)
          ? { recordScanHasMore: true }
          : {}),
        ...(cache
          ? { recordsMessage: "正在更新提交记录…" }
          : handles.length
            ? { recordsMessage: "正在读取提交记录…" }
            : { recordsMessage: "请先在 OJTrace 中配置并启用对应 OJ 账号。" }),
      });
    }
    if (message.type === "REFRESH_CROSS_OJ_RECORDS") {
      const authorizationError = await authorizedRecordListPage(
        sender,
        message.problem,
        message.pageUrl,
      );
      if (typeof authorizationError === "string")
        return crossOjResponse(message.requestId, false, authorizationError, {
          message: "记录列表已切换或题目不匹配，请刷新后重试。",
        });
      const handles = await enabledHandlesForSource(message.problem.oj);
      const cacheKey = recordListCacheKey(message.problem, handles);
      const cache = await readRecordListCache(cacheKey);
      const result = await queryRemoteRecords(
        message.problem,
        handles,
        cache,
        message.continueScan ?? false,
      );
      const problemDifficulty = luoguProblemDifficultyCache.get(
        authorizationError.problemId.toUpperCase(),
      )?.difficulty;
      return crossOjResponse(message.requestId, true, "records-refreshed", {
        records: result.records,
        ...(problemDifficulty !== undefined ? { problemDifficulty } : {}),
        ...(result.recordScanHasMore ? { recordScanHasMore: true } : {}),
        ...(result.message ? { recordsMessage: result.message } : {}),
      });
    }
    if (
      message.type === "GET_CODEFORCES_PROBLEM_STATUS" ||
      message.type === "GET_ATCODER_PROBLEM_STATUS"
    ) {
      if (!isLuoguPageSender(sender))
        return crossOjResponse(message.requestId, false, "unauthorized-sender");
      const sourceTab = await browser.tabs.get(sender.tab.id);
      if (
        sourceTab.url !== sender.url ||
        !sameLuoguPageDocumentUrl(sourceTab.url, sender.url)
      )
        return crossOjResponse(message.requestId, false, "page-url-changed");
      const actualProblem = await resolveLuoguProblemInTab(
        sender.tab.id,
        sender.url,
      );
      const expectedOj =
        message.type === "GET_CODEFORCES_PROBLEM_STATUS"
          ? "codeforces"
          : "atcoder";
      if (
        !sameLuoguProblem(actualProblem, message.problem) ||
        message.problem.oj !== expectedOj
      )
        return crossOjResponse(message.requestId, false, "problem-mismatch");
      const permission =
        expectedOj === "codeforces"
          ? CODEFORCES_PERMISSION
          : ATCODER_PERMISSION;
      if (
        !(await browser.permissions.contains({
          origins: [permission],
        }))
      )
        return crossOjResponse(
          message.requestId,
          true,
          "problem-status-unavailable",
          {
            problemStatus: "unavailable",
            problemStatusMessage:
              expectedOj === "codeforces"
                ? "未授予 Codeforces 站点权限，暂时无法查询提交记录。"
                : "未授予 AtCoder 站点权限，暂时无法查询提交记录。",
          },
        );

      const result = await queryProblemStatus(
        expectedOj,
        message.problem,
        await enabledHandlesForSource(expectedOj),
      );
      return crossOjResponse(
        message.requestId,
        true,
        `problem-status-${result.status}`,
        {
          problemStatus: result.status,
          ...(result.message ? { problemStatusMessage: result.message } : {}),
        },
      );
    }
    if (
      !sender.tab ||
      typeof sender.tab.id !== "number" ||
      sender.frameId !== 0 ||
      !sender.url
    )
      return crossOjResponse(message.requestId, false, "unauthorized-sender");
    const pageUrl = new URL(sender.url);
    if (
      pageUrl.origin !== "https://codeforces.com" &&
      pageUrl.origin !== "https://atcoder.jp"
    )
      return crossOjResponse(message.requestId, false, "unauthorized-sender");

    switch (message.type) {
      case "CLAIM_CROSS_OJ_TASK": {
        const outcome = await service.claim(
          sender.tab.id,
          message.targetLanguageValue,
        );
        return crossOjResponse(message.requestId, outcome.ok, outcome.code, {
          message: outcome.message,
          languageOptions: outcome.languageOptions,
          taskState: outcome.taskState,
          returnUrl: outcome.returnUrl,
          problem: outcome.problem,
        });
      }
      case "RESOLVE_CODEFORCES_SUBMISSION": {
        const outcome = await service.findCodeforcesSubmission(
          sender.tab.id,
          sender.url,
        );
        return crossOjResponse(message.requestId, outcome.ok, outcome.code, {
          submissionDetailUrl: outcome.detailUrl,
        });
      }
      case "UPDATE_CROSS_OJ_TASK": {
        const event =
          message.event.kind === "result-observed" && "index" in message.event
            ? {
                kind: "result-observed" as const,
                submissionId: message.event.submissionId,
                detailUrl: message.event.detailUrl,
                contestId: message.event.contestId,
                index: message.event.index,
                submitReferrer: message.event.submitReferrer,
              }
            : message.event;
        const outcome = await service.update(sender.tab.id, sender.url, event);
        return crossOjResponse(message.requestId, outcome.ok, outcome.code, {
          taskState: outcome.taskState,
          result: outcome.result,
          returnUrl: outcome.returnUrl,
          message: outcome.message,
        });
      }
      case "UPDATE_CROSS_OJ_EVALUATION": {
        const currentTab = await browser.tabs.get(sender.tab.id);
        if (currentTab.url !== sender.url)
          return crossOjResponse(
            message.requestId,
            false,
            "target-page-changed",
          );
        const outcome = await service.updateEvaluation({
          currentUrl: sender.url,
          detailUrl: message.detailUrl,
          submissionId: message.submissionId,
          evaluationStatus: message.evaluationStatus,
        });
        return crossOjResponse(message.requestId, outcome.ok, outcome.code);
      }
    }
  } catch {
    return crossOjResponse(
      message.requestId,
      false,
      "cross-oj-operation-failed",
      {
        message: "跨 OJ 操作失败，请重新发起。",
      },
    );
  }
}

export function isCrossOjSubmitMessage(raw: unknown): boolean {
  return isCrossOjMessage(raw);
}
