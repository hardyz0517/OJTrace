import type {
  CoverageOutcome,
  Diagnostic,
  FetchInput,
  HttpResponse,
  PartialReason,
  Submission,
  ActivityScheduleRecord,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { mergeSubmission, submissionKey } from "../../domain/merge";
import { reportProgress } from "../../domain/sync-progress";
import { isHydroScopeUrl } from "../../domain/hydro-scope";
import { isActivityOutsideWindow } from "../../domain/activity-schedule";
import {
  classifySubmittedAt,
  isCollectionDeadline,
} from "../shared/submission-window";
import { hydroOJActivityRecordsUrl, hydroOJRecordsUrl } from "./instance";
import { normalizeHydroOJSubmission } from "./normalizer";
import {
  isHydroOJLoginPage,
  parseHydroOJRecordPage,
  type HydroActivity,
} from "./parser";
import { assertRecordResponse, failure, requestRecordPage } from "./session";

/** One account's unique records and logical-page budget, shared by all streams. */
export interface HydroCollectionBudget {
  readonly maxPages: number;
  readonly limit: number;
  pagesFetched: number;
  readonly records: Map<string, Submission>;
  readonly activitySchedules: Map<string, ActivityScheduleRecord>;
  stopReason?: "deadline" | "rate-limited";
}

export function createHydroCollectionBudget(
  limit: number,
): HydroCollectionBudget {
  return {
    maxPages: 100,
    limit: Math.min(limit, 1000),
    pagesFetched: 0,
    records: new Map(),
    activitySchedules: new Map(),
  };
}

function resolvePath(
  origin: string,
  path: string | undefined,
  domainId?: string,
): string | undefined {
  if (!path) return undefined;
  try {
    const url = new URL(path, origin);
    return isHydroScopeUrl({ origin, domainId }, url.href)
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
    ...(input.account.domainId ? { domainId: input.account.domainId } : {}),
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
    submissionUrl: resolvePath(
      origin,
      raw.submissionPath,
      input.account.domainId,
    ),
    problemUrl: resolvePath(origin, raw.problemPath, input.account.domainId),
    fallbackListUrl: activity
      ? hydroOJActivityRecordsUrl(
          origin,
          activity.id,
          providerAccountKey,
          1,
          input.account.domainId,
        )
      : hydroOJRecordsUrl(
          origin,
          providerAccountKey,
          1,
          input.account.domainId,
        ),
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

export interface HydroPageResult {
  outcome: CoverageOutcome;
  diagnostics: Diagnostic[];
  /** Unique in-window records seen in this stream, including already buffered duplicates. */
  acceptedRecords: number;
  /** Activity access was denied, not a verified empty or synced stream. */
  excludedByPermission?: true;
}

export function partialOutcome(
  reasons: Iterable<PartialReason>,
): CoverageOutcome {
  const unique = [...new Set(reasons)];
  return {
    status: "partial",
    reasons: [unique[0] ?? "unverified-coverage", ...unique.slice(1)],
  };
}

export function collectionFailureReason(
  input: FetchInput,
  error: unknown,
): PartialReason | undefined {
  if (input.signal.aborted)
    return isCollectionDeadline(input.signal) ? "deadline" : undefined;
  if (!(error instanceof AdapterFailure)) return undefined;
  if (error.error.messageKey === "account.identityChanged") return undefined;
  if (error.error.kind === "rate_limited") return "rate-limited";
  return [
    "network",
    "timeout",
    "parse_failed",
    "blocked",
    "auth_required",
  ].includes(error.error.kind)
    ? "unavailable"
    : undefined;
}

/**
 * No prefetch parameter: every logical list page includes JSON/HTML fallback
 * and one finite session refresh under the same pagination callback.
 */
export async function fetchRecordPages(
  input: FetchInput,
  origin: string,
  providerAccountKey: string,
  cookie: string | undefined,
  activity: HydroActivity | undefined,
  maxPages: number,
  budget: HydroCollectionBudget,
  refreshSession?: () => Promise<void>,
): Promise<HydroPageResult> {
  const diagnostics: Diagnostic[] = [];
  const reasons = new Set<PartialReason>();
  const streamKeys = new Set<string>();
  const seenPages = new Set<string>();
  let verifiedPages = 0;
  let retriedAuth = false;
  // Hydro sorts record ObjectIds descending. This proves a submission-time
  // boundary only when normalized time is the ObjectId's creation time.
  let boundaryTrusted = true;
  let previousId: string | undefined;
  let previousTime: number | undefined;
  let schedule: ActivityScheduleRecord | undefined;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    if (budget.stopReason)
      return {
        outcome: partialOutcome([...reasons, budget.stopReason]),
        diagnostics,
        acceptedRecords: streamKeys.size,
      };
    if (budget.records.size >= budget.limit)
      return {
        outcome: partialOutcome([...reasons, "record-limit"]),
        diagnostics,
        acceptedRecords: streamKeys.size,
      };
    if (budget.pagesFetched >= budget.maxPages)
      return {
        outcome: partialOutcome([...reasons, "page-limit"]),
        diagnostics,
        acceptedRecords: streamKeys.size,
      };

    const pagesBefore = budget.pagesFetched;
    try {
      let page: ReturnType<typeof parseHydroOJRecordPage>;
      try {
        input.signal.throwIfAborted();
        const response = await input.pagination.runPage({
          origin,
          signal: input.signal,
          request: async () => {
            input.signal.throwIfAborted();
            budget.pagesFetched += 1;
            const url = activity
              ? hydroOJActivityRecordsUrl(
                  origin,
                  activity.id,
                  providerAccountKey,
                  pageNumber,
                  input.account.domainId,
                )
              : hydroOJRecordsUrl(
                  origin,
                  providerAccountKey,
                  pageNumber,
                  input.account.domainId,
                );
            let response = await requestRecordPage(input, url, origin, cookie);
            if (
              (response.status === 401 || isHydroOJLoginPage(response.text)) &&
              refreshSession &&
              !retriedAuth
            ) {
              retriedAuth = true;
              await refreshSession();
              response = await requestRecordPage(input, url, origin, cookie);
            }
            assertRecordResponse(input, response);
            return response;
          },
        });
        page = parsePage(input, response);
        verifiedPages += 1;
        if (activity && pageNumber === 1) {
          schedule = {
            source: "hydroj",
            origin,
            ...(input.account.domainId
              ? { domainId: input.account.domainId }
              : {}),
            activityId: activity.id,
            checkedAt: input.now,
            ...page.activitySchedule,
          };
          budget.activitySchedules.set(activity.id, schedule);
        }
      } catch (error) {
        const reason = collectionFailureReason(input, error);
        // Only activity-level permission denial is outside the readable scope.
        // Auth recovery failures, cancellation and deadlines keep their semantics.
        if (
          reason === "unavailable" &&
          activity &&
          error instanceof AdapterFailure &&
          error.error.kind === "blocked" &&
          error.error.stage === "request" &&
          error.error.httpStatus === 403
        )
          return {
            outcome: reasons.size
              ? partialOutcome(reasons)
              : { status: "complete", evidence: "all-streams" },
            diagnostics,
            acceptedRecords: streamKeys.size,
            excludedByPermission: true,
          };
        if (!reason || verifiedPages === 0) throw error;
        if (reason === "deadline" || reason === "rate-limited")
          budget.stopReason = reason;
        diagnostics.push({
          source: "hydroj",
          code: "record-page-unavailable",
          severity: "warning",
          messageKey:
            error instanceof AdapterFailure
              ? error.error.messageKey
              : "source.timeout",
          retryable:
            error instanceof AdapterFailure ? error.error.retryable : true,
        });
        return {
          outcome: partialOutcome([...reasons, reason]),
          diagnostics,
          acceptedRecords: streamKeys.size,
        };
      }

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
        return {
          outcome: partialOutcome([...reasons, "pagination-repeated"]),
          diagnostics,
          acceptedRecords: streamKeys.size,
        };
      }
      if (pageKey) seenPages.add(pageKey);

      // Normalize the complete page before evaluating a time boundary or quota.
      const candidates: Submission[] = [];
      let crossedBoundary = false;
      for (const raw of page.rdocs) {
        if (
          input.account.domainId &&
          raw.domainId !== undefined &&
          raw.domainId !== input.account.domainId
        )
          throw failure(
            input,
            "invalid_response",
            "identity",
            "source.scopeMismatch",
          );
        if (raw.uid !== undefined && String(raw.uid) !== providerAccountKey)
          throw failure(
            input,
            "auth_required",
            "identity",
            "account.identityChanged",
          );
        let normalized: ReturnType<typeof normalizeHydroOJSubmission>;
        try {
          normalized = normalizeHydroOJSubmission(raw);
        } catch {
          boundaryTrusted = false;
          reasons.add("invalid-record");
          if (schedule) {
            schedule = { ...schedule, beginAt: undefined, endAt: undefined };
            budget.activitySchedules.set(schedule.activityId, schedule);
          }
          if (!diagnostics.some((item) => item.code === "record-invalid"))
            diagnostics.push({
              source: "hydroj",
              code: "record-invalid",
              severity: "warning",
              messageKey: "source.invalidRecord",
              retryable: false,
            });
          continue;
        }
        if (
          normalized.timestampBasis !== "object-id" ||
          (previousId !== undefined &&
            normalized.submissionId.toLowerCase() > previousId) ||
          (previousTime !== undefined && normalized.submittedAt > previousTime)
        )
          boundaryTrusted = false;
        previousId = normalized.submissionId.toLowerCase();
        previousTime = normalized.submittedAt;
        if (
          schedule?.beginAt !== undefined &&
          schedule.endAt !== undefined &&
          (normalized.submittedAt < schedule.beginAt ||
            normalized.submittedAt >= schedule.endAt)
        ) {
          schedule = { ...schedule, beginAt: undefined, endAt: undefined };
          budget.activitySchedules.set(schedule.activityId, schedule);
        }
        const position = classifySubmittedAt(normalized.submittedAt, input);
        if (position === "before") crossedBoundary = true;
        if (position === "in-window")
          candidates.push(
            toSubmission(
              input,
              origin,
              providerAccountKey,
              normalized,
              activity,
            ),
          );
        if (position === "invalid") {
          boundaryTrusted = false;
          reasons.add("invalid-record");
        }
      }

      let overflow = false;
      for (const item of candidates) {
        const key = submissionKey(item);
        streamKeys.add(key);
        const previous = budget.records.get(key);
        if (!previous && budget.records.size >= budget.limit) {
          overflow = true;
          continue;
        }
        if (
          previous?.activityId &&
          item.activityId &&
          previous.activityId !== item.activityId
        )
          diagnostics.push({
            source: "hydroj",
            code: "activity-conflict",
            severity: "warning",
            messageKey: "source.activityConflict",
            retryable: false,
          });
        budget.records.set(
          key,
          previous ? mergeSubmission(previous, item) : item,
        );
      }
      if (overflow) reasons.add("record-limit");
      const exhausted =
        page.rdocs.length === 0 || (page.paginationKnown && !page.hasMore);
      const reachedBoundary =
        (boundaryTrusted && crossedBoundary) ||
        isActivityOutsideWindow(schedule, input, input.now);
      if (exhausted || reachedBoundary)
        return {
          outcome: reasons.size
            ? partialOutcome(reasons)
            : {
                status: "complete",
                evidence: reachedBoundary ? "window-boundary" : "exhausted",
              },
          diagnostics,
          acceptedRecords: streamKeys.size,
        };
      if (budget.records.size >= budget.limit)
        return {
          outcome: partialOutcome([...reasons, "record-limit"]),
          diagnostics,
          acceptedRecords: streamKeys.size,
        };
      if (pageNumber === maxPages || budget.pagesFetched >= budget.maxPages)
        return {
          outcome: partialOutcome([...reasons, "page-limit"]),
          diagnostics,
          acceptedRecords: streamKeys.size,
        };
    } finally {
      if (budget.pagesFetched > pagesBefore)
        reportProgress(input.onProgress, {
          phase: activity ? "activities" : "list",
          pagesFetched: budget.pagesFetched,
          recordsFetched: budget.records.size,
        });
    }
  }
  return {
    outcome: partialOutcome([...reasons, "page-limit"]),
    diagnostics,
    acceptedRecords: streamKeys.size,
  };
}
