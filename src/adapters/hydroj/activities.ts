import type {
  CoverageOutcome,
  Diagnostic,
  FetchInput,
  PartialReason,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import {
  activityScheduleKey,
  isActivityOutsideWindow,
} from "../../domain/activity-schedule";
import { reportProgress } from "../../domain/sync-progress";
import { isCollectionDeadline } from "../shared/submission-window";
import { hydroOJUserUrl } from "./instance";
import {
  isHydroOJLoginPage,
  parseHydroUserActivities,
  parseHydroUserActivitiesJson,
  type HydroActivity,
} from "./parser";
import { assertRecordResponse, failure, requestPage } from "./session";
import {
  collectionFailureReason,
  fetchRecordPages,
  partialOutcome,
  type HydroCollectionBudget,
} from "./records";

const MAX_ACTIVITY_COUNT = 50;
const MAX_ACTIVITY_PAGES = 5;

async function discoverActivities(
  input: FetchInput,
  origin: string,
  uid: string,
  cookie: string | undefined,
  budget: HydroCollectionBudget,
  refreshSession?: () => Promise<void>,
): Promise<{
  activities: HydroActivity[];
  diagnostics: Diagnostic[];
  reasons: PartialReason[];
}> {
  // Discovery is a finite user-page probe. Its JSON/HTML and one auth recovery
  // remain one logical page, so new activity discovery cannot bypass pacing.
  const pagesBefore = budget.pagesFetched;
  try {
    const response = await input.pagination.runPage({
      origin,
      signal: input.signal,
      request: async () => {
        input.signal.throwIfAborted();
        budget.pagesFetched += 1;
        const url = hydroOJUserUrl(origin, uid, input.account.domainId);
        let response = await requestPage(input, url, origin, cookie, "json");
        if (
          (response.status === 401 || isHydroOJLoginPage(response.text)) &&
          refreshSession
        ) {
          await refreshSession();
          response = await requestPage(input, url, origin, cookie, "json");
        }
        assertRecordResponse(input, response);
        let supported = false;
        if (/^\s*\{/.test(response.text)) {
          try {
            supported = Array.isArray(JSON.parse(response.text)?.tdocs);
          } catch {
            /* Fall back once to the verified HTML contract. */
          }
        } else supported = /data-page=["']user_detail["']/i.test(response.text);
        if (!supported) {
          response = await requestPage(input, url, origin, cookie, "html");
          assertRecordResponse(input, response);
        }
        return response;
      },
    });
    let parsed: ReturnType<typeof parseHydroUserActivitiesJson>;
    try {
      if (
        !/^\s*\{/.test(response.text) &&
        !/data-page=["']user_detail["']/i.test(response.text)
      )
        throw new Error("Unsupported user page");
      parsed = /^\s*\{/.test(response.text)
        ? parseHydroUserActivitiesJson(JSON.parse(response.text), response.url)
        : {
            activities: parseHydroUserActivities(response.text, response.url),
            invalidCount: 0,
          };
    } catch {
      throw failure(input, "parse_failed", "parse", "source.invalidResponse");
    }
    const diagnostics: Diagnostic[] = [];
    const reasons: PartialReason[] = [];
    if (parsed.invalidCount) {
      reasons.push("invalid-record");
      diagnostics.push({
        source: "hydroj",
        code: "activity-invalid",
        severity: "warning",
        messageKey: "source.activityInvalid",
        retryable: false,
      });
    }
    return {
      activities: parsed.activities,
      diagnostics,
      reasons,
    };
  } finally {
    if (budget.pagesFetched > pagesBefore)
      reportProgress(input.onProgress, {
        phase: "activities",
        pagesFetched: budget.pagesFetched,
        recordsFetched: budget.records.size,
      });
  }
}

export async function collectActivityRecords(
  input: FetchInput,
  origin: string,
  uid: string,
  cookie: string | undefined,
  budget: HydroCollectionBudget,
  refreshSession?: () => Promise<void>,
): Promise<{ outcome: CoverageOutcome; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const reasons = new Set<PartialReason>();
  reportProgress(input.onProgress, { phase: "activities" });
  // Stop before discovery when another stream has already exhausted a budget
  // or observed a 429. An unvisited activity is a coverage gap, never "empty".
  const initialStop =
    budget.stopReason ??
    (budget.records.size >= budget.limit
      ? "record-limit"
      : budget.pagesFetched >= budget.maxPages
        ? "page-limit"
        : undefined);
  if (initialStop) {
    diagnostics.push({
      source: "hydroj",
      code: "activities-unvisited",
      severity: "warning",
      messageKey: "source.activityUnvisited",
      retryable: false,
      context: { status: "unvisited" },
    });
    return { outcome: partialOutcome([initialStop]), diagnostics };
  }

  let discovered: Awaited<ReturnType<typeof discoverActivities>>;
  try {
    discovered = await discoverActivities(
      input,
      origin,
      uid,
      cookie,
      budget,
      refreshSession,
    );
  } catch (error) {
    const reason = collectionFailureReason(input, error);
    if (!reason) throw error;
    if (reason === "rate-limited" || reason === "deadline")
      budget.stopReason = reason;
    diagnostics.push({
      source: "hydroj",
      code: "activity-discovery-failed",
      severity: "warning",
      messageKey:
        error instanceof AdapterFailure
          ? error.error.messageKey
          : "source.timeout",
      retryable: error instanceof AdapterFailure ? error.error.retryable : true,
    });
    return { outcome: partialOutcome([reason]), diagnostics };
  }
  diagnostics.push(...discovered.diagnostics);
  discovered.reasons.forEach((reason) => reasons.add(reason));
  let activitiesCompleted = 0;
  let activitiesAttempted = 0;
  const schedules = new Map(
    (input.activitySchedules ?? [])
      .filter(
        (item) =>
          item.origin === origin && item.domainId === input.account.domainId,
      )
      .map((item) => [activityScheduleKey(item), item]),
  );
  reportProgress(input.onProgress, {
    phase: "activities",
    activitiesCompleted,
    activitiesTotal: discovered.activities.length,
  });

  for (const activity of discovered.activities) {
    if (input.signal.aborted && !isCollectionDeadline(input.signal))
      input.signal.throwIfAborted();
    const context = { activityId: activity.id, activityName: activity.title };
    const schedule = schedules.get(
      activityScheduleKey({
        origin,
        domainId: input.account.domainId,
        activityId: activity.id,
      }),
    );
    if (
      !input.recheckActivities &&
      isActivityOutsideWindow(schedule, input, input.now)
    ) {
      diagnostics.push({
        source: "hydroj",
        code: "activity-" + activity.id,
        severity: "info",
        messageKey: "source.activityCachedOutsideWindow",
        retryable: false,
        context: { ...context, status: "cached-outside-window" },
      });
      activitiesCompleted += 1;
      reportProgress(input.onProgress, {
        phase: "activities",
        activitiesCompleted,
        activitiesTotal: discovered.activities.length,
      });
      continue;
    }
    const stop =
      budget.stopReason ??
      (activitiesAttempted >= MAX_ACTIVITY_COUNT
        ? "activity-limit"
        : budget.records.size >= budget.limit
          ? "record-limit"
          : budget.pagesFetched >= budget.maxPages
            ? "page-limit"
            : undefined);
    if (stop) {
      reasons.add(stop);
      diagnostics.push({
        source: "hydroj",
        code: "activity-" + activity.id,
        severity: "warning",
        messageKey:
          stop === "activity-limit"
            ? "source.activityDiscoveryLimit"
            : "source.activityUnvisited",
        retryable: false,
        context: { ...context, status: "unvisited" },
      });
      continue;
    }
    try {
      activitiesAttempted += 1;
      const result = await fetchRecordPages(
        input,
        origin,
        uid,
        cookie,
        activity,
        MAX_ACTIVITY_PAGES,
        budget,
        refreshSession,
      );
      const partial = result.outcome.status === "partial";
      if (result.outcome.status === "partial")
        result.outcome.reasons.forEach((reason) => reasons.add(reason));
      diagnostics.push(...result.diagnostics);
      if (result.excludedByPermission) continue;
      diagnostics.push({
        source: "hydroj",
        code: "activity-" + activity.id,
        severity: partial ? "warning" : "info",
        messageKey: partial ? "source.activityLimit" : "source.activitySynced",
        retryable: false,
        context: {
          ...context,
          status: partial
            ? "truncated"
            : result.acceptedRecords
              ? "synced"
              : "empty",
        },
      });
    } catch (error) {
      const reason = collectionFailureReason(input, error);
      if (!reason) throw error;
      if (input.signal.aborted && !isCollectionDeadline(input.signal))
        throw error;
      if (reason === "rate-limited" || reason === "deadline")
        budget.stopReason = reason;
      reasons.add(reason);
      const details = error instanceof AdapterFailure ? error.error : undefined;
      diagnostics.push({
        source: "hydroj",
        code: "activity-" + activity.id,
        severity: "warning",
        messageKey: details?.messageKey ?? "source.timeout",
        retryable: details?.retryable ?? true,
        context: {
          ...context,
          status:
            details?.kind === "auth_required" ? "auth-required" : "unavailable",
        },
      });
    } finally {
      // The page collector reports each logical page. This counter reports
      // attempted activities (even failed ones); cache exclusions are counted
      // above, while activities skipped by a budget remain uncompleted.
      activitiesCompleted += 1;
      reportProgress(input.onProgress, {
        phase: "activities",
        activitiesCompleted,
        activitiesTotal: discovered.activities.length,
      });
    }
  }
  return {
    outcome: reasons.size
      ? partialOutcome(reasons)
      : { status: "complete", evidence: "all-streams" },
    diagnostics,
  };
}
