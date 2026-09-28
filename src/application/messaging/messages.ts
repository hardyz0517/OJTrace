import {
  MESSAGE_SCHEMA_VERSION,
  type AccountConfig,
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
  | {
      schemaVersion: 1;
      type: "REQUEST_HOST_PERMISSION";
      requestId: string;
      source: AccountConfig["source"];
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
      ok: false;
      error: { code: string; message: string };
    };

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RuntimeMessage>;
  return (
    item.schemaVersion === MESSAGE_SCHEMA_VERSION &&
    typeof item.type === "string" &&
    typeof item.requestId === "string" &&
    item.requestId.length > 0 &&
    [
      "GET_STATE",
      "SYNC_REQUEST",
      "UPDATE_ACCOUNT",
      "DELETE_ACCOUNT",
      "REQUEST_HOST_PERMISSION",
    ].includes(item.type)
  );
}

export function isSchemaVersionSupported(value: unknown): value is 1 {
  return value === MESSAGE_SCHEMA_VERSION;
}
