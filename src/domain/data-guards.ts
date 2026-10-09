import {
  isSourceId,
  type AccountRecord,
  type AdapterError,
  type Diagnostic,
  type InstanceBrandingRecord,
  type Preferences,
  type Submission,
  type SyncState,
} from "./types";
import type { BrowserSessionAccount, SyncCoverage } from "./adapter";
import type { AccountSyncProgress } from "./sync-progress";
import { isPaginationPolicy } from "./pagination-policy";
import { isSyncRangePreference } from "./sync-range";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const string = (value: unknown): value is string => typeof value === "string";
const boolean = (value: unknown): value is boolean =>
  typeof value === "boolean";
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value) && value >= 0;
const optional = (value: unknown, check: (value: unknown) => boolean) =>
  value === undefined || check(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(string);
const oneOf = (value: unknown, values: readonly string[]) =>
  string(value) && values.includes(value);

export function isAccountRecord(value: unknown): value is AccountRecord {
  return (
    isRecord(value) &&
    string(value.accountId) &&
    isSourceId(value.source) &&
    boolean(value.enabled) &&
    oneOf(value.authMode, [
      "public-handle",
      "browser-session",
      "manual-cookie",
      "password",
    ]) &&
    string(value.providerAccountKey) &&
    string(value.identityKey) &&
    [
      value.verifiedAt,
      value.createdAt,
      value.updatedAt,
      value.credentialRevision,
    ].every(finite) &&
    [
      value.label,
      value.origin,
      value.domainId,
      value.providerDisplayName,
    ].every((item) => optional(item, string))
  );
}

export function isSubmission(value: unknown): value is Submission {
  return (
    isRecord(value) &&
    isSourceId(value.source) &&
    string(value.accountId) &&
    string(value.submissionId) &&
    oneOf(value.identityQuality, ["stable", "composite"]) &&
    string(value.problemId) &&
    finite(value.submittedAt) &&
    finite(value.fetchedAt) &&
    isRecord(value.verdict) &&
    string(value.verdict.raw) &&
    oneOf(value.verdict.code, [
      "accepted",
      "wrong_answer",
      "compilation_error",
      "runtime_error",
      "time_limit",
      "memory_limit",
      "pending",
      "partial",
      "rejected",
      "skipped",
      "other",
    ]) &&
    [
      value.providerAccountKey,
      value.origin,
      value.domainId,
      value.problemName,
      value.language,
      value.submissionUrl,
      value.problemUrl,
      value.fallbackListUrl,
      value.activityId,
      value.activityName,
      value.activityUrl,
    ].every((item) => optional(item, string)) &&
    [value.score, value.timeMs, value.memoryKb, value.codeLength].every(
      (item) => optional(item, finite),
    ) &&
    optional(value.activityType, (item) =>
      oneOf(item, ["contest", "homework", "other"]),
    )
  );
}

export function isDiagnostic(value: unknown): value is Diagnostic {
  return (
    isRecord(value) &&
    isSourceId(value.source) &&
    string(value.code) &&
    oneOf(value.severity, ["info", "warning", "error"]) &&
    string(value.messageKey) &&
    boolean(value.retryable) &&
    optional(
      value.context,
      (context) =>
        isRecord(context) &&
        [context.activityId, context.activityName, context.status].every(
          (item) => optional(item, string),
        ),
    )
  );
}

export function isAdapterError(value: unknown): value is AdapterError {
  return (
    isRecord(value) &&
    isSourceId(value.source) &&
    oneOf(value.kind, [
      "permission_required",
      "auth_required",
      "rate_limited",
      "blocked",
      "timeout",
      "network",
      "invalid_response",
      "parse_failed",
      "unsupported",
      "unknown",
    ]) &&
    oneOf(value.stage, ["identity", "request", "parse", "normalize", "url"]) &&
    string(value.messageKey) &&
    boolean(value.retryable) &&
    string(value.requestId) &&
    optional(value.userAction, (item) =>
      oneOf(item, [
        "grant_permission",
        "open_site_login",
        "retry_later",
        "edit_account",
      ]),
    ) &&
    [value.httpStatus, value.retryAfterMs].every((item) =>
      optional(item, finite),
    )
  );
}

export function isSyncState(value: unknown): value is SyncState {
  return (
    isRecord(value) &&
    boolean(value.stale) &&
    [value.lastAttemptAt, value.lastSuccessAt].every((item) =>
      optional(item, finite),
    ) &&
    optional(value.lastError, isAdapterError)
  );
}

export function isInstanceBrandingRecord(
  value: unknown,
): value is InstanceBrandingRecord {
  return (
    isRecord(value) &&
    isSourceId(value.source) &&
    string(value.origin) &&
    string(value.name) &&
    finite(value.fetchedAt) &&
    [value.domainId, value.iconDataUrl].every((item) =>
      optional(item, string),
    ) &&
    optional(value.iconFetchedAt, finite)
  );
}

export function isPreferences(value: unknown): value is Preferences {
  return (
    isRecord(value) &&
    finite(value.retentionPerAccount) &&
    finite(value.freshnessCooldownMs) &&
    optional(value.syncAccountIds, strings) &&
    optional(value.syncRange, isSyncRangePreference) &&
    optional(
      value.paginationBySource,
      (policies) =>
        isRecord(policies) &&
        Object.entries(policies).every(
          ([source, policy]) =>
            isSourceId(source) && isPaginationPolicy(policy),
        ),
    )
  );
}

export function isSyncCoverage(value: unknown): value is SyncCoverage {
  if (
    !isRecord(value) ||
    !isRecord(value.window) ||
    !finite(value.window.since) ||
    !finite(value.window.until) ||
    value.window.since < 0 ||
    value.window.until < value.window.since ||
    !count(value.pagesFetched) ||
    !count(value.acceptedRecords) ||
    !isRecord(value.outcome)
  )
    return false;
  const outcome = value.outcome;
  return outcome.status === "complete"
    ? oneOf(outcome.evidence, ["exhausted", "window-boundary", "all-streams"])
    : outcome.status === "partial" &&
        strings(outcome.reasons) &&
        outcome.reasons.length > 0 &&
        outcome.reasons.every((item) =>
          oneOf(item, [
            "record-limit",
            "page-limit",
            "activity-limit",
            "deadline",
            "pagination-repeated",
            "unverified-coverage",
            "invalid-record",
            "rate-limited",
            "unavailable",
          ]),
        );
}

export function isAccountSyncProgress(
  value: unknown,
): value is AccountSyncProgress {
  return (
    isRecord(value) &&
    string(value.accountId) &&
    isSourceId(value.source) &&
    oneOf(value.status, [
      "running",
      "complete",
      "partial",
      "failed",
      "skipped",
      "cancelled",
    ]) &&
    oneOf(value.phase, [
      "queued",
      "identity",
      "list",
      "activities",
      "details",
      "branding",
      "done",
    ]) &&
    count(value.pagesFetched) &&
    count(value.recordsFetched) &&
    [
      value.pageEstimate,
      value.activitiesCompleted,
      value.activitiesTotal,
      value.detailsCompleted,
      value.detailsTotal,
    ].every((item) => optional(item, count)) &&
    optional(value.messageKey, string) &&
    optional(value.reasons, strings) &&
    optional(
      value.diagnostics,
      (items) => Array.isArray(items) && items.every(isDiagnostic),
    )
  );
}

export function isBrowserSessionAccount(
  value: unknown,
): value is BrowserSessionAccount {
  return (
    isRecord(value) &&
    boolean(value.authenticated) &&
    oneOf(value.status, [
      "authenticated",
      "unauthenticated",
      "network-error",
      "permission-denied",
      "site-error",
      "unsupported",
    ]) &&
    [value.username, value.uid, value.diagnostic].every((item) =>
      optional(item, string),
    )
  );
}
