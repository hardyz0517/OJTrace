import {
  type FetchInput,
  type Diagnostic,
  type Submission,
} from "../../domain";
import { AdapterFailure } from "../../domain/errors";
import { hydroOJUserUrl } from "./instance";
import {
  isHydroOJLoginPage,
  parseHydroUserActivities,
  parseHydroUserActivitiesJson,
  type HydroActivity,
} from "./parser";
import { requestPage } from "./session";
import { fetchRecordPages } from "./records";

const MAX_ACTIVITY_COUNT = 50;
const MAX_ACTIVITY_PAGES = 5;

async function discoverActivities(
  input: FetchInput,
  origin: string,
  uid: string,
  cookie: string | undefined,
): Promise<{ activities: HydroActivity[]; diagnostics: Diagnostic[] }> {
  let response = await requestPage(
    input,
    hydroOJUserUrl(origin, uid),
    origin,
    cookie,
    "json",
  );
  if (
    response.status >= 200 &&
    response.status < 300 &&
    !isHydroOJLoginPage(response.text)
  ) {
    let supported = false;
    if (/^\s*\{/.test(response.text)) {
      try {
        supported = Array.isArray(JSON.parse(response.text)?.tdocs);
      } catch {
        /* Use the HTML contract. */
      }
    } else supported = /data-page=["']user_detail["']/i.test(response.text);
    if (!supported)
      response = await requestPage(
        input,
        hydroOJUserUrl(origin, uid),
        origin,
        cookie,
        "html",
      );
  }
  if (response.status === 401 || isHydroOJLoginPage(response.text)) {
    return {
      activities: [],
      diagnostics: [
        {
          source: "hydroj",
          code: "activity-auth-required",
          severity: "warning",
          messageKey: "source.authRequired",
          retryable: true,
        },
      ],
    };
  }
  if (response.status < 200 || response.status >= 300) {
    return {
      activities: [],
      diagnostics: [
        {
          source: "hydroj",
          code: "activity-discovery-failed",
          severity: "warning",
          messageKey: "source.httpError",
          retryable: response.status >= 500,
        },
      ],
    };
  }
  try {
    if (
      !/^\s*\{/.test(response.text) &&
      !/data-page=["']user_detail["']/i.test(response.text)
    )
      throw new Error("Unsupported user page");
    const parsed = /^\s*\{/.test(response.text)
      ? parseHydroUserActivitiesJson(JSON.parse(response.text), response.url)
      : {
          activities: parseHydroUserActivities(response.text, response.url),
          invalidCount: 0,
        };
    const { activities, invalidCount } = parsed;
    const truncated = activities.length > MAX_ACTIVITY_COUNT;
    const diagnostics: Diagnostic[] = [];
    if (invalidCount)
      diagnostics.push({
        source: "hydroj",
        code: "activity-invalid",
        severity: "warning",
        messageKey: "source.activityInvalid",
        retryable: false,
      });
    if (truncated)
      diagnostics.push({
        source: "hydroj",
        code: "activity-discovery-limit",
        severity: "warning",
        messageKey: "source.activityDiscoveryLimit",
        retryable: false,
      });
    return {
      activities: activities.slice(0, MAX_ACTIVITY_COUNT),
      diagnostics,
    };
  } catch {
    return {
      activities: [],
      diagnostics: [
        {
          source: "hydroj",
          code: "activity-parse-failed",
          severity: "warning",
          messageKey: "source.invalidResponse",
          retryable: false,
        },
      ],
    };
  }
}

export async function collectActivityRecords(
  input: FetchInput,
  origin: string,
  uid: string,
  cookie?: string,
  refreshSession?: () => Promise<void>,
): Promise<{
  records: Submission[];
  diagnostics: Diagnostic[];
  hasMore: boolean;
}> {
  let discovered: Awaited<ReturnType<typeof discoverActivities>>;
  try {
    discovered = await discoverActivities(input, origin, uid, cookie);
    if (
      refreshSession &&
      discovered.diagnostics.some(
        (item) => item.code === "activity-auth-required",
      )
    ) {
      await refreshSession();
      discovered = await discoverActivities(input, origin, uid, cookie);
    }
  } catch (error) {
    if (input.signal.aborted) throw error;
    return {
      records: [],
      diagnostics: [
        {
          source: "hydroj",
          code: "activity-discovery-failed",
          severity: "warning",
          messageKey: "source.networkError",
          retryable: true,
        },
      ],
      hasMore: false,
    };
  }
  const records: Submission[] = [];
  const diagnostics = [...discovered.diagnostics];
  let hasMore = discovered.diagnostics.some(
    (item) => item.code === "activity-discovery-limit",
  );
  for (const activity of discovered.activities) {
    const context = { activityId: activity.id, activityName: activity.title };
    try {
      const result = await fetchRecordPages(
        input,
        origin,
        uid,
        cookie,
        activity,
        undefined,
        MAX_ACTIVITY_PAGES,
        Math.min(100, input.limit),
        refreshSession,
      );
      records.push(...result.records);
      diagnostics.push(...result.diagnostics, {
        source: "hydroj",
        code: `activity-${activity.id}`,
        severity: result.hasMore ? "warning" : "info",
        messageKey: result.hasMore
          ? "source.activityLimit"
          : "source.activitySynced",
        retryable: false,
        context: {
          ...context,
          status: result.hasMore
            ? "truncated"
            : result.records.length
              ? "synced"
              : "empty",
        },
      });
      hasMore ||= result.hasMore;
    } catch (error) {
      if (input.signal.aborted) throw error;
      const details = error instanceof AdapterFailure ? error.error : undefined;
      diagnostics.push({
        source: "hydroj",
        code: `activity-${activity.id}`,
        severity: "warning",
        messageKey: details?.messageKey ?? "source.networkError",
        retryable: details?.retryable ?? true,
        context: {
          ...context,
          status:
            details?.httpStatus === 403
              ? "permission-denied"
              : details?.kind === "auth_required"
                ? "auth-required"
                : "unavailable",
        },
      });
    }
  }
  return { records, diagnostics, hasMore };
}
