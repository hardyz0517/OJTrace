import {
  MESSAGE_SCHEMA_VERSION,
  type AccountAuthMode,
  type AccountConfig,
  type BrowserSessionAccount,
  type SourceId,
  type StoredData,
} from "../../domain";
import type { SyncResult } from "../sync/sync-service";

export type RuntimeMessage =
  | { schemaVersion: 1; type: "GET_STATE"; requestId: string }
  | {
      schemaVersion: 1;
      type: "SYNC_REQUEST";
      requestId: string;
      force: boolean;
      accountIds?: string[];
    }
  | {
      schemaVersion: 1;
      type: "UPDATE_SYNC_ACCOUNTS";
      requestId: string;
      accountIds: string[];
    }
  | {
      schemaVersion: 1;
      type: "UPDATE_ACCOUNT";
      requestId: string;
      account: AccountConfig;
    }
  | {
      schemaVersion: 1;
      type: "DELETE_ACCOUNT";
      requestId: string;
      accountId: string;
    }
  | { schemaVersion: 1; type: "CLEAR_DATA"; requestId: string }
  | { schemaVersion: 1; type: "CLEAR_ACCOUNTS"; requestId: string }
  | { schemaVersion: 1; type: "CLEAR_SUBMISSIONS"; requestId: string }
  | {
      schemaVersion: 1;
      type: "REQUEST_HOST_PERMISSION";
      requestId: string;
      source: AccountConfig["source"];
    }
  | {
      schemaVersion: 1;
      type: "DETECT_BROWSER_SESSION";
      requestId: string;
      source: SourceId;
      origin?: string;
      pageIdentity?: string;
    }
  | {
      schemaVersion: 1;
      type: "AUTHORIZE_ACCOUNT";
      requestId: string;
      source: SourceId;
      authMode: AccountAuthMode;
      identifier?: string;
      credentials?: Record<string, string>;
      cookie?: string;
      origin?: string;
      permissionsGranted?: boolean;
    };

export type RuntimeResponse =
  | {
      schemaVersion: 1;
      requestId: string;
      ok: true;
      type: "STATE";
      data: StoredData;
    }
  | {
      schemaVersion: 1;
      requestId: string;
      ok: true;
      type: "SYNC_RESULT";
      result: SyncResult;
    }
  | {
      schemaVersion: 1;
      requestId: string;
      ok: true;
      type: "CLEARED";
    }
  | {
      schemaVersion: 1;
      requestId: string;
      ok: true;
      type: "UPDATED";
      data: StoredData;
    }
  | {
      schemaVersion: 1;
      requestId: string;
      ok: true;
      type: "PERMISSION";
      granted: boolean;
    }
  | {
      schemaVersion: 1;
      requestId: string;
      ok: true;
      type: "AUTHORIZED";
      data: StoredData;
      account: AccountConfig;
    }
  | {
      schemaVersion: 1;
      requestId: string;
      ok: true;
      type: "BROWSER_SESSION";
      source: SourceId;
      account: BrowserSessionAccount;
    }
  | {
      schemaVersion: 1;
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
      "UPDATE_ACCOUNT",
      "DELETE_ACCOUNT",
      "CLEAR_DATA",
      "CLEAR_ACCOUNTS",
      "CLEAR_SUBMISSIONS",
      "REQUEST_HOST_PERMISSION",
      "DETECT_BROWSER_SESSION",
      "AUTHORIZE_ACCOUNT",
    ].includes(item.type)
  ) {
    if (item.type === "UPDATE_SYNC_ACCOUNTS") {
      const accountIds = (item as { accountIds?: unknown }).accountIds;
      return (
        Array.isArray(accountIds) &&
        accountIds.every(
          (accountId) => typeof accountId === "string" && accountId.length > 0,
        )
      );
    }
    if (item.type === "SYNC_REQUEST") {
      const accountIds = (item as { accountIds?: unknown }).accountIds;
      return (
        typeof (item as { force?: unknown }).force === "boolean" &&
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
        ((item as { pageIdentity?: unknown }).pageIdentity === undefined ||
          typeof (item as { pageIdentity?: unknown }).pageIdentity === "string")
      );
    }
    if (item.type === "AUTHORIZE_ACCOUNT") {
      const account = item as {
        source?: unknown;
        authMode?: unknown;
        identifier?: unknown;
        credentials?: unknown;
        cookie?: unknown;
        origin?: unknown;
      };
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
        (account.cookie === undefined || typeof account.cookie === "string") &&
        (account.origin === undefined || typeof account.origin === "string") &&
        (account.authMode === "browser-session" ||
          account.authMode === "manual-cookie" ||
          account.authMode === "password" ||
          (typeof account.identifier === "string" &&
            account.identifier.trim().length > 0)) &&
        ((account.authMode !== "manual-cookie" &&
          account.authMode !== "password") ||
          (typeof account.cookie === "string" &&
            account.cookie.trim().length > 0) ||
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

export function isSchemaVersionSupported(value: unknown): value is 1 {
  return value === MESSAGE_SCHEMA_VERSION;
}
