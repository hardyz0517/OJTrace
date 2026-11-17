import type {
  CrossOjEvaluationStatus,
  CrossOjProblemRef,
  CrossOjRecordListItem,
  ProblemRef,
} from "./model";
import {
  atCoderSubmissionsPageUrl,
  ATCODER_SUBMISSIONS_MAX_PAGES,
  parseAtCoderSubmissionsPage,
} from "./atcoder-submissions";

export const CODEFORCES_RECORD_PAGE_SIZE = 1000;
export const CODEFORCES_RECORD_MAX_PAGES = 20;
export const ATCODER_RECORD_MAX_PAGES = ATCODER_SUBMISSIONS_MAX_PAGES;

export interface CrossOjRecordsQueryResult {
  records: CrossOjRecordListItem[];
  cursors: Record<string, number>;
  scanOffsets: Record<string, number>;
  message?: string;
  incomplete?: boolean;
  hasMore?: boolean;
}

interface CodeforcesStatusPage {
  status: "OK" | "FAILED";
  comment?: string;
  result?: Array<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeHandle(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,32}$/.test(value);
}

function uniqueHandles(handles: readonly string[]): string[] {
  const seen = new Set<string>();
  return handles
    .map((handle) => handle.trim())
    .filter((handle) => {
      const normalized = handle.toLowerCase();
      if (!safeHandle(handle) || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function statusFromCodeforcesVerdict(
  verdict: unknown,
): CrossOjEvaluationStatus {
  if (verdict === "OK") return "accepted";
  if (
    verdict === "TESTING" ||
    verdict === "QUEUE" ||
    verdict === "RUNNING" ||
    verdict === "PENDING"
  )
    return "judging";
  return verdict ? "rejected" : "unknown";
}

function codeforcesRecordUrl(contestId: string, submissionId: string): string {
  return `https://codeforces.com/contest/${encodeURIComponent(contestId)}/submission/${encodeURIComponent(submissionId)}`;
}

function codeforcesProblemMatches(
  value: Record<string, unknown>,
  problem: ProblemRef,
): boolean {
  const candidate = isRecord(value.problem) ? value.problem : undefined;
  return (
    String(candidate?.contestId ?? "") === problem.contestId &&
    typeof candidate?.index === "string" &&
    candidate.index.toUpperCase() === problem.index.toUpperCase()
  );
}

function parseCodeforcesPage(value: unknown): CodeforcesStatusPage {
  if (!isRecord(value) || (value.status !== "OK" && value.status !== "FAILED"))
    throw new Error("Codeforces returned an invalid status response.");
  if (value.status === "FAILED")
    throw new Error(
      typeof value.comment === "string"
        ? value.comment.slice(0, 180)
        : "Codeforces API request failed.",
    );
  if (
    !Array.isArray(value.result) ||
    value.result.length > CODEFORCES_RECORD_PAGE_SIZE
  )
    throw new Error("Codeforces returned an invalid submission list.");
  return {
    status: "OK",
    result: value.result.filter(isRecord),
  };
}

function codeforcesRecordFromApi(
  value: Record<string, unknown>,
  handle: string,
): CrossOjRecordListItem | undefined {
  const id = value.id;
  const problem = isRecord(value.problem) ? value.problem : undefined;
  const contestId = String(problem?.contestId ?? "");
  const index = typeof problem?.index === "string" ? problem.index : "";
  if (!Number.isSafeInteger(id) || !contestId || !index) return undefined;
  const submittedAt =
    typeof value.creationTimeSeconds === "number" &&
    Number.isFinite(value.creationTimeSeconds)
      ? value.creationTimeSeconds * 1000
      : undefined;
  if (submittedAt === undefined) return undefined;
  const submissionId = String(id);
  return {
    oj: "codeforces",
    submissionId,
    problemId: `${contestId}/${index.toUpperCase()}`,
    detailUrl: codeforcesRecordUrl(contestId, submissionId),
    observedAt: submittedAt,
    statusUpdatedAt: Date.now(),
    evaluationStatus: statusFromCodeforcesVerdict(value.verdict),
    ...(typeof value.verdict === "string" ? { rawVerdict: value.verdict } : {}),
    accountName: handle,
    ...(typeof problem?.name === "string" ? { problemName: problem.name } : {}),
    ...(typeof value.programmingLanguage === "string"
      ? { language: value.programmingLanguage }
      : {}),
    ...(typeof value.points === "number" && Number.isFinite(value.points)
      ? { score: value.points }
      : {}),
    ...(typeof value.timeConsumedMillis === "number" &&
    Number.isSafeInteger(value.timeConsumedMillis)
      ? { timeMs: value.timeConsumedMillis }
      : {}),
    ...(typeof value.memoryConsumedBytes === "number" &&
    Number.isSafeInteger(value.memoryConsumedBytes)
      ? { memoryBytes: value.memoryConsumedBytes }
      : {}),
    ...(typeof value.passedTestCount === "number" &&
    Number.isSafeInteger(value.passedTestCount) &&
    value.passedTestCount >= 0
      ? { passedTestCount: value.passedTestCount }
      : {}),
  };
}

async function queryCodeforcesHandle(
  handle: string,
  problem: ProblemRef,
  cursor: number | undefined,
  scanOffset: number | undefined,
  continueScan: boolean,
  pageBudget: number,
  cachedRecords: readonly CrossOjRecordListItem[],
  requestPage: (url: string) => Promise<unknown>,
): Promise<{
  records: CrossOjRecordListItem[];
  cursor: number;
  scanOffset: number;
  incomplete: boolean;
  limited: boolean;
}> {
  const records: CrossOjRecordListItem[] = [];
  const pendingIds = new Set(
    cachedRecords
      .filter(
        (record) =>
          record.evaluationStatus === "judging" ||
          record.evaluationStatus === "unknown",
      )
      .map((record) => record.submissionId),
  );
  let latestId = cursor ?? 0;
  let nextOffset = scanOffset ?? 0;
  let incomplete = false;
  let limited = false;
  const inProgress = scanOffset !== undefined && scanOffset > 0;
  const historicalContinuation = continueScan && inProgress;
  const initialOffset = historicalContinuation ? scanOffset : 1;
  const firstPageNumber = Math.ceil(
    initialOffset / CODEFORCES_RECORD_PAGE_SIZE,
  );
  for (
    let page = 0, from = initialOffset;
    page < pageBudget && firstPageNumber + page <= CODEFORCES_RECORD_MAX_PAGES;
    page += 1
  ) {
    const parsed = parseCodeforcesPage(
      await requestPage(
        `https://codeforces.com/api/contest.status?${new URLSearchParams({
          contestId: problem.contestId,
          handle,
          from: String(from),
          count: String(CODEFORCES_RECORD_PAGE_SIZE),
        })}`,
      ),
    );
    let reachedEnd = false;
    for (const item of parsed.result ?? []) {
      const id = typeof item.id === "number" ? item.id : Number(item.id);
      if (Number.isSafeInteger(id) && id > latestId) latestId = id;
      if (cursor !== undefined && Number.isSafeInteger(id) && id <= cursor)
        reachedEnd = true;
      if (
        codeforcesProblemMatches(item, problem) &&
        (historicalContinuation ||
          cursor === undefined ||
          id > cursor ||
          pendingIds.has(String(id)))
      ) {
        const record = codeforcesRecordFromApi(item, handle);
        if (record) {
          records.push(record);
          pendingIds.delete(record.submissionId);
        }
      }
    }
    if (
      !historicalContinuation &&
      cursor !== undefined &&
      cursor > 0 &&
      reachedEnd &&
      pendingIds.size === 0
    ) {
      incomplete = false;
      nextOffset = inProgress ? scanOffset : 0;
      break;
    }
    if ((parsed.result?.length ?? 0) < CODEFORCES_RECORD_PAGE_SIZE) {
      incomplete = false;
      nextOffset = 0;
      break;
    }
    from += parsed.result?.length ?? CODEFORCES_RECORD_PAGE_SIZE;
    nextOffset = from;
    incomplete = true;
    if (firstPageNumber + page + 1 >= CODEFORCES_RECORD_MAX_PAGES) {
      limited = true;
      nextOffset = 0;
      break;
    }
  }
  if (inProgress && !continueScan) {
    nextOffset = scanOffset;
    incomplete = true;
  } else if (nextOffset > 0) {
    incomplete = true;
  }
  return {
    records,
    cursor: latestId,
    scanOffset: nextOffset,
    incomplete,
    limited,
  };
}

async function queryAtCoderHandle(
  handle: string,
  problem: Extract<CrossOjProblemRef, { oj: "atcoder" }>,
  requestPage: (url: string) => Promise<unknown>,
  cursor: number | undefined,
  cachedRecords: readonly CrossOjRecordListItem[],
  scanOffset: number | undefined,
  continueScan: boolean,
  pageBudget: number,
  stopOnAccepted = false,
): Promise<{
  records: CrossOjRecordListItem[];
  cursor: number;
  scanOffset: number;
  incomplete: boolean;
  limited: boolean;
}> {
  const records: CrossOjRecordListItem[] = [];
  let incomplete = false;
  let limited = false;
  let latestId = BigInt(cursor ?? 0);
  const inProgress = scanOffset !== undefined && scanOffset > 0;
  const historicalContinuation = continueScan && inProgress;
  const firstPage = historicalContinuation ? scanOffset : 1;
  let nextPage = scanOffset ?? 0;
  const cachedIds = cachedRecords
    .map((record) => record.submissionId)
    .filter((id) => /^\d+$/.test(id))
    .map((id) => BigInt(id));
  const newestCachedId = cachedIds.length
    ? cachedIds.reduce((max, id) => (id > max ? id : max))
    : undefined;
  const pendingIds = new Set(
    cachedRecords
      .filter(
        (record) =>
          record.evaluationStatus === "judging" ||
          record.evaluationStatus === "unknown",
      )
      .map((record) => record.submissionId),
  );
  for (
    let page = firstPage, pagesFetched = 0;
    pagesFetched < pageBudget && page <= ATCODER_RECORD_MAX_PAGES;
    page += 1, pagesFetched += 1
  ) {
    const raw = await requestPage(
      atCoderSubmissionsPageUrl(handle, problem, page),
    );
    if (typeof raw !== "string")
      throw new Error("AtCoder returned an invalid submissions page.");
    const parsed = parseAtCoderSubmissionsPage(raw, handle, problem);
    let reachedCachedBoundary = false;
    for (const record of parsed.records) {
      const id = BigInt(record.submissionId);
      if (id > latestId) latestId = id;
      if (
        historicalContinuation ||
        newestCachedId === undefined ||
        id > newestCachedId ||
        pendingIds.has(record.submissionId)
      ) {
        records.push(record);
        pendingIds.delete(record.submissionId);
      }
      if (newestCachedId !== undefined && id <= newestCachedId)
        reachedCachedBoundary = true;
    }
    if (
      stopOnAccepted &&
      parsed.records.some((record) => record.evaluationStatus === "accepted")
    ) {
      nextPage = 0;
      break;
    }
    if (!historicalContinuation && reachedCachedBoundary) {
      nextPage = inProgress ? scanOffset : 0;
      break;
    }
    if (!parsed.hasNextPage) {
      nextPage = 0;
      break;
    }
    nextPage = page + 1;
    incomplete = true;
    if (page === ATCODER_RECORD_MAX_PAGES) {
      limited = true;
      nextPage = 0;
      break;
    }
    if (pagesFetched + 1 >= pageBudget) break;
  }
  if (inProgress && !continueScan) {
    nextPage = scanOffset;
    incomplete = true;
  } else if (nextPage > 0) {
    incomplete = true;
  }
  return {
    records,
    cursor: latestId <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(latestId) : 0,
    scanOffset: nextPage,
    incomplete,
    limited,
  };
}

function mergeRecords(
  records: CrossOjRecordListItem[],
): CrossOjRecordListItem[] {
  const unique = new Map<string, CrossOjRecordListItem>();
  for (const record of records) {
    const key = `${record.oj}:${record.submissionId}`;
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()]
    .sort((left, right) => right.observedAt - left.observedAt)
    .slice(0, 1000);
}

export async function queryCrossOjRecords(input: {
  handles: readonly string[];
  problem: CrossOjProblemRef;
  requestPage: (url: string) => Promise<unknown>;
  stopOnAccepted?: boolean;
  cursors?: Readonly<Record<string, number>>;
  scanOffsets?: Readonly<Record<string, number>>;
  continueScan?: boolean;
  pageBudget?: number;
  cachedRecords?: readonly CrossOjRecordListItem[];
}): Promise<CrossOjRecordsQueryResult> {
  const handles = uniqueHandles(input.handles);
  if (!handles.length)
    return {
      records: [],
      cursors: {},
      scanOffsets: {},
      message: "请先在 OJTrace 中配置并启用对应 OJ 账号。",
    };

  const records: CrossOjRecordListItem[] = [];
  const cursors: Record<string, number> = { ...input.cursors };
  const scanOffsets: Record<string, number> = { ...input.scanOffsets };
  let firstError: unknown;
  let incomplete = false;
  let limited = false;
  const continueScan = Boolean(
    input.continueScan &&
    Object.values(scanOffsets).some((offset) => offset > 0),
  );
  const pageBudget = Math.max(
    1,
    Math.min(
      ATCODER_RECORD_MAX_PAGES,
      input.pageBudget ?? ATCODER_RECORD_MAX_PAGES,
    ),
  );
  for (const handle of handles) {
    try {
      if (input.problem.oj === "codeforces") {
        const key = handle.toLowerCase();
        const scanOffset = scanOffsets[key];
        if (continueScan && !(scanOffset && scanOffset > 0)) continue;
        const cachedForHandle = (input.cachedRecords ?? []).filter(
          (record) =>
            record.accountName?.toLowerCase() === handle.toLowerCase(),
        );
        const result = await queryCodeforcesHandle(
          handle,
          input.problem,
          cursors[key],
          scanOffset,
          continueScan,
          pageBudget,
          cachedForHandle,
          input.requestPage,
        );
        records.push(...result.records);
        cursors[key] = result.cursor;
        scanOffsets[key] = result.scanOffset;
        incomplete ||= result.incomplete;
        limited ||= result.limited;
      } else {
        const key = handle.toLowerCase();
        const scanOffset = scanOffsets[key];
        if (continueScan && !(scanOffset && scanOffset > 0)) continue;
        const cachedForHandle = (input.cachedRecords ?? []).filter(
          (record) =>
            record.accountName?.toLowerCase() === handle.toLowerCase(),
        );
        const result = await queryAtCoderHandle(
          handle,
          input.problem,
          input.requestPage,
          cursors[key],
          cachedForHandle,
          scanOffset,
          continueScan,
          pageBudget,
          input.stopOnAccepted,
        );
        records.push(...result.records);
        cursors[key] = result.cursor;
        scanOffsets[key] = result.scanOffset;
        incomplete ||= result.incomplete;
        limited ||= result.limited;
        if (
          input.stopOnAccepted &&
          result.records.some(
            (record) => record.evaluationStatus === "accepted",
          )
        )
          break;
      }
    } catch (error) {
      firstError ??= error;
    }
  }
  const merged = mergeRecords(records);
  if (firstError && !merged.length)
    return {
      records: [],
      cursors,
      scanOffsets,
      incomplete: true,
      hasMore: false,
      message:
        firstError instanceof Error
          ? `查询失败：${firstError.message.slice(0, 180)}`
          : "查询失败，请稍后重试。",
    };
  if (firstError)
    return {
      records: merged,
      cursors,
      scanOffsets,
      message: "部分账号查询失败，列表可能不完整。",
      incomplete: true,
      hasMore: false,
    };
  const hasMore = Object.values(scanOffsets).some((offset) => offset > 0);
  if (limited)
    return {
      records: merged,
      cursors,
      scanOffsets,
      message: "提交记录较多，已达到单次扫描上限，列表可能不完整。",
      incomplete: true,
      hasMore,
    };
  if (incomplete || hasMore)
    return {
      records: merged,
      cursors,
      scanOffsets,
      message: "正在读取更早的提交记录…",
      incomplete: true,
      hasMore,
    };
  return { records: merged, cursors, scanOffsets, hasMore: false };
}
