import {
  type FetchInput,
  type HttpResponse,
  type Submission,
  type Diagnostic,
} from "../../domain";
import { hydroOJActivityRecordsUrl, hydroOJRecordsUrl } from "./instance";
import { normalizeHydroOJSubmission } from "./normalizer";
import {
  isHydroOJLoginPage,
  parseHydroOJRecordPage,
  type HydroActivity,
} from "./parser";
import { assertRecordResponse, failure, requestRecordPage } from "./session";

function resolvePath(
  origin: string,
  path: string | undefined,
): string | undefined {
  if (!path) return undefined;
  try {
    const url = new URL(path, origin);
    return url.origin === origin && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function toSubmission(
  input: FetchInput,
  origin: string,
  providerAccountKey: string,
  raw: ReturnType<typeof normalizeHydroOJSubmission>,
  activity?: HydroActivity,
): Submission {
  return {
    source: "hydroj",
    accountId: input.account.accountId,
    providerAccountKey,
    origin,
    submissionId: raw.submissionId,
    identityQuality: "stable",
    problemId: raw.problemId,
    problemName: raw.problemName,
    submittedAt: raw.submittedAt,
    verdict: raw.verdict,
    score: raw.score,
    timeMs: raw.timeMs,
    memoryKb: raw.memoryKb,
    language: raw.language,
    submissionUrl: resolvePath(origin, raw.submissionPath),
    problemUrl: resolvePath(origin, raw.problemPath),
    fallbackListUrl: activity
      ? hydroOJActivityRecordsUrl(origin, activity.id, providerAccountKey)
      : hydroOJRecordsUrl(origin, providerAccountKey),
    ...(activity
      ? {
          activityId: activity.id,
          activityName: activity.title,
          activityType: activity.type,
          activityUrl: activity.url,
        }
      : {}),
    fetchedAt: input.now,
  };
}

function parsePage(input: FetchInput, response: HttpResponse) {
  try {
    return parseHydroOJRecordPage(response.text, response.url);
  } catch {
    throw failure(input, "parse_failed", "parse", "source.invalidResponse");
  }
}

export async function fetchRecordPages(
  input: FetchInput,
  origin: string,
  providerAccountKey: string,
  cookie: string | undefined,
  activity: HydroActivity | undefined,
  firstResponse: HttpResponse | undefined,
  maxPages: number,
  recordLimit = input.limit,
  refreshSession?: () => Promise<void>,
): Promise<{
  records: Submission[];
  hasMore: boolean;
  diagnostics: Diagnostic[];
}> {
  const records: Submission[] = [];
  const diagnostics: Diagnostic[] = [];
  let response =
    firstResponse ??
    (await requestRecordPage(
      input,
      activity
        ? hydroOJActivityRecordsUrl(origin, activity.id, providerAccountKey)
        : hydroOJRecordsUrl(origin, providerAccountKey),
      origin,
      cookie,
    ));
  let pageNumber = 1;
  let hasMore = false;
  let observedPageSize: number | undefined;
  let reachedSince = false;
  let retriedAuth = false;
  const seenPages = new Set<string>();
  while (pageNumber <= maxPages) {
    if (
      (response.status === 401 || isHydroOJLoginPage(response.text)) &&
      refreshSession &&
      !retriedAuth
    ) {
      retriedAuth = true;
      await refreshSession();
      response = await requestRecordPage(
        input,
        activity
          ? hydroOJActivityRecordsUrl(
              origin,
              activity.id,
              providerAccountKey,
              pageNumber,
            )
          : hydroOJRecordsUrl(origin, providerAccountKey, pageNumber),
        origin,
        cookie,
      );
    }
    assertRecordResponse(input, response);
    const page = parsePage(input, response);
    if (observedPageSize === undefined && page.rdocs.length > 0)
      observedPageSize = page.rdocs.length;
    const pageKey = page.rdocs
      .map((raw) => String(raw._id ?? raw.rid ?? ""))
      .join(",");
    if (pageKey && seenPages.has(pageKey)) {
      diagnostics.push({
        source: "hydroj",
        code: "record-pagination-repeated",
        severity: "warning",
        messageKey: "source.paginationRepeated",
        retryable: false,
      });
      hasMore = true;
      break;
    }
    if (pageKey) seenPages.add(pageKey);
    for (const raw of page.rdocs) {
      try {
        if (raw.uid !== undefined && String(raw.uid) !== providerAccountKey)
          throw new Error("Record belongs to a different account");
        const normalized = normalizeHydroOJSubmission(raw);
        if (input.since !== undefined && normalized.submittedAt < input.since)
          reachedSince = true;
        if (input.since !== undefined && normalized.submittedAt < input.since)
          continue;
        records.push(
          toSubmission(input, origin, providerAccountKey, normalized, activity),
        );
      } catch {
        if (!diagnostics.some((item) => item.code === "record-invalid"))
          diagnostics.push({
            source: "hydroj",
            code: "record-invalid",
            severity: "warning",
            messageKey: "source.invalidRecord",
            retryable: false,
          });
      }
    }
    hasMore =
      page.hasMore ||
      (/^\s*\{/.test(response.text) &&
        !reachedSince &&
        page.rdocs.length > 0 &&
        page.rdocs.length >= (observedPageSize ?? page.rdocs.length));
    if (reachedSince) hasMore = false;
    if (!hasMore || page.rdocs.length === 0 || records.length >= recordLimit)
      break;
    if (pageNumber === maxPages) break;
    pageNumber += 1;
    response = await requestRecordPage(
      input,
      activity
        ? hydroOJActivityRecordsUrl(
            origin,
            activity.id,
            providerAccountKey,
            pageNumber,
          )
        : hydroOJRecordsUrl(origin, providerAccountKey, pageNumber),
      origin,
      cookie,
    );
  }
  return {
    records: records.slice(0, recordLimit),
    hasMore: hasMore || records.length > recordLimit,
    diagnostics,
  };
}
