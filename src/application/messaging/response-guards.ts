import {
  MESSAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION,
  isSourceId,
} from "../../domain/types";
import {
  isRecord,
  isAccountRecord,
  isSubmission,
  isDiagnostic,
  isAdapterError,
  isSyncState,
  isInstanceBrandingRecord,
  isPreferences,
  isSyncCoverage,
  isAccountSyncProgress,
  isBrowserSessionAccount,
} from "../../domain/data-guards";
import type { PublicStoredData } from "../accounts/account-queries";
import type { RuntimeMessage, RuntimeResponse } from "./messages";

/** Validate the public DTO without repairing or replacing invalid storage. */
export function isPublicStoredData(value: unknown): value is PublicStoredData {
  return (
    isRecord(value) &&
    value.schemaVersion === STORAGE_SCHEMA_VERSION &&
    typeof value.revision === "number" &&
    Number.isFinite(value.revision) &&
    !Object.hasOwn(value, "credentials") &&
    !Object.hasOwn(value, "activitySchedules") &&
    Array.isArray(value.accounts) &&
    value.accounts.every(
      (account) =>
        isAccountRecord(account) &&
        isRecord(account) &&
        typeof account.credentialConfigured === "boolean",
    ) &&
    Array.isArray(value.submissions) &&
    value.submissions.every(isSubmission) &&
    isRecord(value.instanceBranding) &&
    Object.values(value.instanceBranding).every(isInstanceBrandingRecord) &&
    isRecord(value.syncStates) &&
    Object.values(value.syncStates).every(isSyncState) &&
    isPreferences(value.preferences)
  );
}

function isSyncSourceResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.accountId === "string" &&
    isSourceId(value.source) &&
    typeof value.stale === "boolean" &&
    Array.isArray(value.records) &&
    value.records.every(isSubmission) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isDiagnostic) &&
    (value.coverage === undefined || isSyncCoverage(value.coverage)) &&
    (value.error === undefined || isAdapterError(value.error)) &&
    (value.instanceBranding === undefined ||
      isInstanceBrandingRecord(value.instanceBranding)) &&
    (value.skipped === undefined ||
      ["freshness", "busy", "superseded", "disabled", "cancelled"].includes(
        String(value.skipped),
      ))
  );
}

export function isRuntimeResponse(value: unknown): value is RuntimeResponse {
  if (
    !isRecord(value) ||
    value.schemaVersion !== MESSAGE_SCHEMA_VERSION ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0
  )
    return false;
  if (value.ok === false)
    return (
      isRecord(value.error) &&
      typeof value.error.code === "string" &&
      typeof value.error.message === "string"
    );
  if (value.ok !== true) return false;
  switch (value.type) {
    case "STATE":
    case "UPDATED":
      return isPublicStoredData(value.data);
    case "CLEARED":
      return true;
    case "AUTHORIZED":
      return (
        isPublicStoredData(value.data) &&
        isAccountRecord(value.account) &&
        typeof value.superseded === "boolean"
      );
    case "BROWSER_SESSION":
      return isSourceId(value.source) && isBrowserSessionAccount(value.account);
    case "SYNC_RESULT": {
      const result = value.result;
      return (
        isRecord(result) &&
        isPublicStoredData(result.data) &&
        Array.isArray(result.sources) &&
        result.sources.every(isSyncSourceResult) &&
        Array.isArray(result.progress) &&
        result.progress.every(isAccountSyncProgress) &&
        typeof result.addedRecords === "number" &&
        Number.isSafeInteger(result.addedRecords) &&
        result.addedRecords >= 0
      );
    }
    default:
      return false;
  }
}

const responseTypeByCommand = {
  GET_STATE: "STATE",
  SYNC_REQUEST: "SYNC_RESULT",
  UPDATE_SYNC_ACCOUNTS: "UPDATED",
  UPDATE_SYNC_RANGE: "UPDATED",
  UPDATE_PAGINATION_POLICY: "UPDATED",
  DELETE_ACCOUNT: "UPDATED",
  CLEAR_DATA: "CLEARED",
  CLEAR_ACCOUNTS: "UPDATED",
  CLEAR_SUBMISSIONS: "UPDATED",
  AUTHORIZE_ACCOUNT: "AUTHORIZED",
  DETECT_BROWSER_SESSION: "BROWSER_SESSION",
} as const satisfies Record<
  RuntimeMessage["type"],
  Extract<RuntimeResponse, { ok: true }>["type"]
>;

export function responseMatchesRequest(
  response: RuntimeResponse,
  message: RuntimeMessage,
): boolean {
  return (
    response.requestId === message.requestId &&
    (!response.ok ||
      (response.type === responseTypeByCommand[message.type] &&
        (response.type !== "BROWSER_SESSION" ||
          (message.type === "DETECT_BROWSER_SESSION" &&
            response.source === message.source))))
  );
}
