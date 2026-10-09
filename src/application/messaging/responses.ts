import {
  MESSAGE_SCHEMA_VERSION,
  type StoredData,
  type BrowserSessionAccount,
  type SourceId,
} from "../../domain";
import { publicStoredData } from "../accounts/account-queries";
import type { AccountService } from "../accounts/account-service";
import type { SyncResult } from "../sync/sync-service";
import type { RuntimeResponse } from "./messages";

export function messageEnvelope(requestId: string) {
  return { schemaVersion: MESSAGE_SCHEMA_VERSION, requestId };
}

export function dataResponse(
  requestId: string,
  type: "STATE" | "UPDATED",
  data: StoredData,
): RuntimeResponse {
  return {
    ...messageEnvelope(requestId),
    ok: true,
    type,
    data: publicStoredData(data),
  };
}

export function authorizedResponse(
  requestId: string,
  saved: Awaited<ReturnType<AccountService["authorize"]>>,
): RuntimeResponse {
  return {
    ...messageEnvelope(requestId),
    ok: true,
    type: "AUTHORIZED",
    data: publicStoredData(saved.data),
    account: saved.account,
    superseded: saved.superseded,
  };
}

export function syncResultResponse(
  requestId: string,
  result: SyncResult,
): RuntimeResponse {
  return {
    ...messageEnvelope(requestId),
    ok: true,
    type: "SYNC_RESULT",
    result: {
      ...result,
      data: publicStoredData(result.data),
      sources: result.sources.map(
        ({ activitySchedules: _activitySchedules, ...source }) => source,
      ),
    },
  };
}

export function browserSessionResponse(
  requestId: string,
  source: SourceId,
  account: BrowserSessionAccount,
): RuntimeResponse {
  return {
    ...messageEnvelope(requestId),
    ok: true,
    type: "BROWSER_SESSION",
    source,
    account,
  };
}

export function clearedResponse(requestId: string): RuntimeResponse {
  return { ...messageEnvelope(requestId), ok: true, type: "CLEARED" };
}

export function responseError(
  requestId: string,
  message: string,
  code = "invalid_request",
): RuntimeResponse {
  return { ...messageEnvelope(requestId), ok: false, error: { code, message } };
}
