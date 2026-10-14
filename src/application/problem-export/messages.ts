import type {
  ProblemDocument,
  ProblemPageProbe,
  ProblemPreview,
} from "../../problem/domain";
import type { ProblemExportJob } from "./export-state";

export type ProblemExportFallbackJob = Pick<
  ProblemExportJob,
  "token" | "tabId" | "expectedUrl" | "createdAt" | "expiresAt"
>;

/** Messages dedicated to the popup and the problem-export page. */
export const PROBLEM_EXPORT_SCHEMA_VERSION = 1 as const;

export type ProblemExportMessage =
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "INSPECT_ACTIVE_PROBLEM_PAGE";
      requestId: string;
      tabId: number;
      expectedUrl?: string;
      probe?: ProblemPageProbe;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "START_PROBLEM_EXPORT";
      requestId: string;
      tabId: number;
      expectedUrl?: string;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "EXTRACT_PROBLEM_MARKDOWN";
      requestId: string;
      tabId: number;
      expectedUrl?: string;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "OPEN_TIMELINE";
      requestId: string;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "OPEN_SETTINGS";
      requestId: string;
    };

export type ProblemExportCommand = ProblemExportMessage extends infer Item
  ? Item extends {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      requestId: string;
    }
    ? Omit<Item, "schemaVersion" | "requestId">
    : never
  : never;

export type ProblemExportResponse =
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      requestId: string;
      ok: true;
      type: "PROBLEM_PREVIEW";
      preview: ProblemPreview | null;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      requestId: string;
      ok: true;
      type: "EXPORT_STARTED";
      job: Pick<ProblemExportJob, "token" | "expiresAt">;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      requestId: string;
      ok: true;
      type: "PROBLEM_MARKDOWN";
      markdown: string;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      requestId: string;
      ok: true;
      type: "NAVIGATED";
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      requestId: string;
      ok: false;
      error: { code: string; message: string };
    };

export type ProblemExportPortRequest =
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "PROBLEM_EXPORT_CONNECT";
      requestId: string;
      token: string;
      job?: ProblemExportFallbackJob;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "PROBLEM_EXPORT_START";
      requestId?: string;
      token: string;
      job?: ProblemExportFallbackJob;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "PROBLEM_EXPORT_CANCEL";
      requestId: string;
      token: string;
    };

export type ProblemExportPortEvent =
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "PROBLEM_EXPORT_DOCUMENT";
      requestId: string;
      token: string;
      document: ProblemDocument;
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "PROBLEM_EXPORT_PROGRESS";
      requestId: string;
      token: string;
      phase: "capturing" | "extracting" | "ready";
    }
  | {
      schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
      type: "PROBLEM_EXPORT_ERROR";
      requestId: string;
      token: string;
      error: string;
      code?: string;
    };

export function problemExportEnvelope(requestId: string) {
  return { schemaVersion: PROBLEM_EXPORT_SCHEMA_VERSION, requestId } as const;
}

export function isProblemExportMessage(
  value: unknown,
): value is ProblemExportMessage {
  if (!isEnvelope(value)) return false;
  const item = value as Partial<ProblemExportMessage> & {
    tabId?: unknown;
    expectedUrl?: unknown;
  };
  if (
    ![
      "INSPECT_ACTIVE_PROBLEM_PAGE",
      "START_PROBLEM_EXPORT",
      "EXTRACT_PROBLEM_MARKDOWN",
      "OPEN_TIMELINE",
      "OPEN_SETTINGS",
    ].includes(String(item.type))
  )
    return false;
  if (item.type === "OPEN_TIMELINE" || item.type === "OPEN_SETTINGS")
    return true;
  return (
    typeof item.tabId === "number" &&
    Number.isInteger(item.tabId) &&
    item.tabId >= 0 &&
    (item.expectedUrl === undefined || typeof item.expectedUrl === "string")
  );
}

export function isProblemExportPortRequest(
  value: unknown,
): value is ProblemExportPortRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProblemExportPortRequest> & {
    schemaVersion?: unknown;
    job?: unknown;
  };
  return (
    (item.schemaVersion === undefined ||
      item.schemaVersion === PROBLEM_EXPORT_SCHEMA_VERSION) &&
    (item.type === "PROBLEM_EXPORT_CONNECT" ||
      item.type === "PROBLEM_EXPORT_START" ||
      item.type === "PROBLEM_EXPORT_CANCEL") &&
    typeof item.token === "string" &&
    item.token.length >= 12 &&
    item.token.length <= 128 &&
    (item.job === undefined || isFallbackJob(item.job))
  );
}

function isFallbackJob(value: unknown): value is ProblemExportFallbackJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<ProblemExportFallbackJob>;
  return (
    typeof job.token === "string" &&
    job.token.length >= 12 &&
    job.token.length <= 128 &&
    typeof job.tabId === "number" &&
    Number.isInteger(job.tabId) &&
    job.tabId >= 0 &&
    typeof job.expectedUrl === "string" &&
    job.expectedUrl.length > 0 &&
    typeof job.createdAt === "number" &&
    Number.isFinite(job.createdAt) &&
    typeof job.expiresAt === "number" &&
    Number.isFinite(job.expiresAt) &&
    job.expiresAt > job.createdAt
  );
}

export function isProblemExportPortEvent(
  value: unknown,
): value is ProblemExportPortEvent {
  if (!isEnvelope(value)) return false;
  const item = value as Partial<ProblemExportPortEvent>;
  return (
    (item.type === "PROBLEM_EXPORT_DOCUMENT" ||
      item.type === "PROBLEM_EXPORT_PROGRESS" ||
      item.type === "PROBLEM_EXPORT_ERROR") &&
    typeof item.token === "string" &&
    typeof item.requestId === "string"
  );
}

function isEnvelope(value: unknown): value is {
  schemaVersion: typeof PROBLEM_EXPORT_SCHEMA_VERSION;
  type: string;
  requestId: string;
} {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProblemExportMessage>;
  return (
    item.schemaVersion === PROBLEM_EXPORT_SCHEMA_VERSION &&
    typeof item.type === "string" &&
    typeof item.requestId === "string" &&
    item.requestId.length > 0
  );
}

export function isProblemExportResponse(
  value: unknown,
): value is ProblemExportResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProblemExportResponse>;
  if (
    item.schemaVersion !== PROBLEM_EXPORT_SCHEMA_VERSION ||
    typeof item.requestId !== "string" ||
    item.requestId.length === 0
  )
    return false;
  // Failure responses intentionally have no `type`. Requiring the success
  // envelope here turned every real background error into a format error.
  if (item.ok === false) {
    const error = item.error;
    return Boolean(
      error &&
      typeof error === "object" &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string",
    );
  }
  if (!isEnvelope(value) || item.ok !== true) return false;
  if (item.type === "PROBLEM_PREVIEW") return "preview" in item;
  if (item.type === "NAVIGATED") return true;
  if (item.type === "PROBLEM_MARKDOWN")
    return typeof item.markdown === "string" && item.markdown.trim().length > 0;
  if (item.type !== "EXPORT_STARTED") return false;
  const job = item.job;
  return Boolean(
    job &&
    typeof job === "object" &&
    typeof (job as { token?: unknown }).token === "string" &&
    typeof (job as { expiresAt?: unknown }).expiresAt === "number",
  );
}
