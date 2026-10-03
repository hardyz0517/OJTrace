import {
  MESSAGE_SCHEMA_VERSION,
  type AccountAuthMode,
  type AccountConfig,
  type AccountRecord,
  type BrowserSessionAccount,
  type SourceId,
  type Diagnostic,
  type SyncRangePreference,
  isSyncRangePreference,
} from "../../domain";
import type { PublicStoredData } from "../accounts/account-queries";
import type { SyncResult } from "../sync/sync-service";

export type RuntimeMessage =
  | { schemaVersion: 2; type: "GET_STATE"; requestId: string }
  | {
      schemaVersion: 2;
      type: "SYNC_REQUEST";
      requestId: string;
      force: boolean;
      accountIds?: string[];
      since?: number;
      until?: number;
    }
  | {
      schemaVersion: 2;
      type: "UPDATE_SYNC_ACCOUNTS";
      requestId: string;
      accountIds: string[];
    }
  | {
      schemaVersion: 2;
      type: "UPDATE_SYNC_RANGE";
      requestId: string;
      range: SyncRangePreference;
    }
  | {
      schemaVersion: 2;
      type: "DELETE_ACCOUNT";
      requestId: string;
      accountId: string;
    }
  | { schemaVersion: 2; type: "CLEAR_DATA"; requestId: string }
  | { schemaVersion: 2; type: "CLEAR_ACCOUNTS"; requestId: string }
  | { schemaVersion: 2; type: "CLEAR_SUBMISSIONS"; requestId: string }
  | {
      schemaVersion: 2;
      type: "REQUEST_HOST_PERMISSION";
      requestId: string;
      source: AccountConfig["source"];
    }
  | {
      schemaVersion: 2;
      type: "DETECT_BROWSER_SESSION";
      requestId: string;
      source: SourceId;
      origin?: string;
      pageIdentity?: string;
    }
  | {
      schemaVersion: 2;
      type: "AUTHORIZE_ACCOUNT";
      requestId: string;
      source: SourceId;
      authMode: AccountAuthMode;
      identifier?: string;
      credentials?: Record<string, string>;
      origin?: string;
    };

export type RuntimeResponse =
  | {
      schemaVersion: 2;
      requestId: string;
      ok: true;
      type: "STATE";
      data: PublicStoredData;
    }
  | {
      schemaVersion: 2;
      requestId: string;
      ok: true;
      type: "SYNC_RESULT";
      result: Omit<SyncResult, "data"> & { data: PublicStoredData };
    }
  | {
      schemaVersion: 2;
      requestId: string;
      ok: true;
      type: "CLEARED";
    }
  | {
      schemaVersion: 2;
      requestId: string;
      ok: true;
      type: "UPDATED";
      data: PublicStoredData;
    }
  | {
      schemaVersion: 2;
      requestId: string;
      ok: true;
      type: "PERMISSION";
      granted: boolean;
    }
  | {
      schemaVersion: 2;
      requestId: string;
      ok: true;
      type: "AUTHORIZED";
      data: PublicStoredData;
      account: AccountRecord;
      diagnostics: Diagnostic[];
      superseded: boolean;
    }
  | {
      schemaVersion: 2;
      requestId: string;
      ok: true;
      type: "BROWSER_SESSION";
      source: SourceId;
      account: BrowserSessionAccount;
    }
  | {
      schemaVersion: 2;
      requestId: string;
      ok: false;
      error: { code: string; message: string };
    };

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RuntimeMessage>;
  if (
    item.schemaVersion === MESSAGE_SCHEMA_VERSION &&
    typeof item.type === "string" &&
    typeof item.requestId === "string" &&
    item.requestId.length > 0 &&
    [
      "GET_STATE",
      "SYNC_REQUEST",
      "UPDATE_SYNC_ACCOUNTS",
      "UPDATE_SYNC_RANGE",
      "DELETE_ACCOUNT",
      "CLEAR_DATA",
      "CLEAR_ACCOUNTS",
      "CLEAR_SUBMISSIONS",
      "REQUEST_HOST_PERMISSION",
      "DETECT_BROWSER_SESSION",
      "AUTHORIZE_ACCOUNT",
    ].includes(item.type)
  ) {
    if (item.type === "DELETE_ACCOUNT") {
      return (
        typeof item.accountId === "string" && item.accountId.trim().length > 0
      );
    }
    if (item.type === "REQUEST_HOST_PERMISSION") {
      return ["codeforces", "luogu", "qoj", "atcoder", "hydroj"].includes(
        item.source ?? "",
      );
    }
    if (item.type === "UPDATE_SYNC_ACCOUNTS") {
      const accountIds = (item as { accountIds?: unknown }).accountIds;
      return (
        Array.isArray(accountIds) &&
        accountIds.every(
          (accountId) => typeof accountId === "string" && accountId.length > 0,
        )
      );
    }
    if (item.type === "UPDATE_SYNC_RANGE") {
      return isSyncRangePreference((item as { range?: unknown }).range);
    }
    if (item.type === "SYNC_REQUEST") {
      const accountIds = (item as { accountIds?: unknown }).accountIds;
      const since = (item as { since?: unknown }).since;
      const until = (item as { until?: unknown }).until;
      return (
        typeof (item as { force?: unknown }).force === "boolean" &&
        (since === undefined ||
          (typeof since === "number" &&
            Number.isFinite(since) &&
            since >= 0)) &&
        (until === undefined ||
          (typeof until === "number" &&
            Number.isFinite(until) &&
            until >= 0 &&
            (since === undefined ||
              (typeof since === "number" && until >= since)))) &&
        (accountIds === undefined ||
          (Array.isArray(accountIds) &&
            accountIds.every(
              (accountId) =>
                typeof accountId === "string" && accountId.length > 0,
            )))
      );
    }
    if (item.type === "DETECT_BROWSER_SESSION") {
      return (
        ["codeforces", "luogu", "qoj", "atcoder", "hydroj"].includes(
          (item as { source?: unknown }).source as string,
        ) &&
        (item.origin === undefined || typeof item.origin === "string") &&
        (item.pageIdentity === undefined ||
          typeof item.pageIdentity === "string")
      );
    }
    if (item.type === "AUTHORIZE_ACCOUNT") {
      const account = item as {
        source?: unknown;
        authMode?: unknown;
        identifier?: unknown;
        credentials?: unknown;
        origin?: unknown;
      };
      if ("cookie" in account) return false;
      const credentialsValid =
        account.credentials === undefined ||
        (typeof account.credentials === "object" &&
          account.credentials !== null &&
          !Array.isArray(account.credentials) &&
          Object.entries(account.credentials).every(
            ([key, value]) =>
              key.length > 0 &&
              typeof value === "string" &&
              !/[\r\n]/.test(value),
          ));
      return (
        ["codeforces", "luogu", "qoj", "atcoder", "hydroj"].includes(
          account.source as string,
        ) &&
        [
          "public-handle",
          "browser-session",
          "manual-cookie",
          "password",
        ].includes(account.authMode as string) &&
        (account.identifier === undefined ||
          typeof account.identifier === "string") &&
        credentialsValid &&
        (account.origin === undefined || typeof account.origin === "string") &&
        (account.authMode === "browser-session" ||
          account.authMode === "manual-cookie" ||
          account.authMode === "password" ||
          (typeof account.identifier === "string" &&
            account.identifier.trim().length > 0)) &&
        ((account.authMode !== "manual-cookie" &&
          account.authMode !== "password") ||
          (credentialsValid &&
            Object.values(
              (account.credentials ?? {}) as Record<string, string>,
            ).some((value) => value.trim().length > 0)))
      );
    }
    return true;
  }
  return false;
}

export function isSchemaVersionSupported(value: unknown): value is 2 {
  return value === MESSAGE_SCHEMA_VERSION;
}
