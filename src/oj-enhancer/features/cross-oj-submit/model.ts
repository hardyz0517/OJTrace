export const CROSS_OJ_SCHEMA_VERSION = 1 as const;

export interface ProblemRef {
  oj: "codeforces";
  contestId: string;
  index: string;
  source: "luogu-pid" | "luogu-origin-link";
}

export interface AtCoderProblemRef {
  oj: "atcoder";
  contestId: string;
  taskId: string;
  source: "luogu-pid" | "luogu-origin-link";
  originUrl?: string;
}

export type CrossOjProblemRef = ProblemRef | AtCoderProblemRef;

export type CrossOjEvaluationStatus =
  "judging" | "accepted" | "rejected" | "unknown";

export interface CrossOjSubmissionRecord {
  oj: CrossOjProblemRef["oj"];
  submissionId: string;
  problemId: string;
  detailUrl: string;
  observedAt: number;
  evaluationStatus: CrossOjEvaluationStatus;
  statusUpdatedAt: number;
}

export interface CrossOjLanguageOption {
  value: string;
  label: string;
}

export type CrossOjFormInspection =
  | {
      status: "ready";
      languageOptions: CrossOjLanguageOption[];
      codePresent: boolean;
      problemMatches?: boolean;
      documentId?: string;
    }
  | { status: "login-required" }
  | { status: "security-check" }
  | { status: "form-unavailable" }
  | { status: "problem-mismatch" }
  | { status: "editor-unavailable" };

export type CrossOjFillResult =
  | { status: "filled"; languageLabel: string }
  | { status: "submit-attempted"; languageLabel: string }
  | { status: "submit-triggered"; languageLabel: string }
  | { status: "existing-code" }
  | { status: "problem-mismatch" }
  | { status: "language-mismatch" }
  | { status: "editor-unavailable" }
  | { status: "changed" }
  | {
      status: "submit-blocked";
      reason:
        | "challenge-timeout"
        | "submit-control-not-found"
        | "submit-control-ambiguous"
        | "submit-control-error"
        | "source-mismatch";
    }
  | { status: "submit-uncertain" };

export interface EditorSnapshot {
  code: string;
  luoguLanguage: string;
  editorKind: string;
  capturedAt: number;
}

export type CrossOjTaskState =
  | "pending"
  | "claimed"
  | "submitting"
  | "awaiting-user-submit"
  | "observing-result"
  | "completed"
  | "result-unknown"
  | "failed";

export interface CrossOjSubmitTask {
  sourceTabId: number;
  sourceUrl: string;
  targetOrigin: "https://codeforces.com" | "https://atcoder.jp";
  targetTabId: number;
  problem: CrossOjProblemRef;
  editor?: EditorSnapshot;
  createdAt: number;
  expiresAt: number;
  state: CrossOjTaskState;
  submitObservedAt?: number;
  errorCode?:
    | "unsupported-language"
    | "editor-unavailable"
    | "target-page-changed"
    | "expired"
    | "result-unmatched"
    | "internal-error";
  result?: {
    submissionId?: string;
    detailUrl?: string;
    observedAt: number;
  };
}

export type CrossOjMessage =
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "CREATE_CROSS_OJ_TASK";
      sourceTabId?: number;
      sourceUrl?: string;
      problem: CrossOjProblemRef;
      editor: EditorSnapshot;
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "CAPTURE_CROSS_OJ_EDITOR";
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "CHECK_CROSS_OJ_PAGE_ACCESS";
      problem: CrossOjProblemRef;
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "CLAIM_CROSS_OJ_TASK";
      targetLanguageValue?: string;
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "UPDATE_CROSS_OJ_TASK";
      event:
        | { kind: "submit-observed"; submitUrl: string }
        | {
            kind: "result-observed";
            submissionId: string;
            detailUrl: string;
            contestId: string;
            index: string;
          }
        | {
            kind: "result-observed";
            oj: "atcoder";
            submissionId: string;
            detailUrl: string;
            contestId: string;
            taskId: string;
          }
        | { kind: "result-unmatched" };
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "UPDATE_CROSS_OJ_EVALUATION";
      submissionId: string;
      detailUrl: string;
      evaluationStatus: CrossOjEvaluationStatus;
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "GET_CROSS_OJ_HISTORY";
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "CANCEL_CROSS_OJ_TASK";
    };

export type CrossOjCommand = CrossOjMessage extends infer Message
  ? Message extends CrossOjMessage
    ? Omit<Message, "schemaVersion" | "requestId">
    : never
  : never;

export interface CrossOjResponse {
  schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
  requestId: string;
  ok: boolean;
  code: string;
  targetUrl?: string;
  returnUrl?: string;
  message?: string;
  targetTabId?: number;
  languageOptions?: Array<{ value: string; label: string }>;
  taskState?: CrossOjTaskState;
  result?: CrossOjSubmitTask["result"];
  history?: CrossOjSubmissionRecord[];
  editor?: EditorSnapshot;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function isCrossOjMessage(value: unknown): value is CrossOjMessage {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== CROSS_OJ_SCHEMA_VERSION ||
    typeof value.requestId !== "string" ||
    !value.requestId
  )
    return false;
  switch (value.type) {
    case "CREATE_CROSS_OJ_TASK":
      return (
        (value.sourceTabId === undefined ||
          Number.isInteger(value.sourceTabId)) &&
        (value.sourceUrl === undefined ||
          typeof value.sourceUrl === "string") &&
        isProblemRef(value.problem) &&
        isEditorSnapshot(value.editor)
      );
    case "CAPTURE_CROSS_OJ_EDITOR":
      return true;
    case "CHECK_CROSS_OJ_PAGE_ACCESS":
      return isProblemRef(value.problem);
    case "CLAIM_CROSS_OJ_TASK":
      return (
        value.targetLanguageValue === undefined ||
        typeof value.targetLanguageValue === "string"
      );
    case "UPDATE_CROSS_OJ_TASK":
      return (
        isRecord(value.event) &&
        ((value.event.kind === "submit-observed" &&
          typeof value.event.submitUrl === "string") ||
          value.event.kind === "result-unmatched" ||
          (value.event.kind === "result-observed" &&
            typeof value.event.submissionId === "string" &&
            typeof value.event.detailUrl === "string" &&
            typeof value.event.contestId === "string" &&
            typeof value.event.index === "string") ||
          (value.event.kind === "result-observed" &&
            value.event.oj === "atcoder" &&
            typeof value.event.submissionId === "string" &&
            typeof value.event.detailUrl === "string" &&
            typeof value.event.contestId === "string" &&
            typeof value.event.taskId === "string"))
      );
    case "UPDATE_CROSS_OJ_EVALUATION":
      return (
        typeof value.submissionId === "string" &&
        /^\d{1,20}$/.test(value.submissionId) &&
        typeof value.detailUrl === "string" &&
        value.detailUrl.length <= 2048 &&
        (value.evaluationStatus === "judging" ||
          value.evaluationStatus === "accepted" ||
          value.evaluationStatus === "rejected" ||
          value.evaluationStatus === "unknown")
      );
    case "GET_CROSS_OJ_HISTORY":
      return true;
    case "CANCEL_CROSS_OJ_TASK":
      return true;
    default:
      return false;
  }
}

function isProblemRef(value: unknown): value is CrossOjProblemRef {
  if (!isRecord(value)) return false;
  if (value.oj === "codeforces")
    return (
      typeof value.contestId === "string" &&
      typeof value.index === "string" &&
      (value.source === "luogu-pid" || value.source === "luogu-origin-link")
    );
  if (value.oj === "atcoder")
    return (
      typeof value.contestId === "string" &&
      typeof value.taskId === "string" &&
      (value.source === "luogu-pid" || value.source === "luogu-origin-link") &&
      (value.source !== "luogu-origin-link" ||
        (typeof value.originUrl === "string" && value.originUrl.length <= 2048))
    );
  return false;
}

function isEditorSnapshot(value: unknown): value is EditorSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === "string" &&
    value.code.length > 0 &&
    value.code.length <= 256_000 &&
    typeof value.luoguLanguage === "string" &&
    value.luoguLanguage.length <= 120 &&
    typeof value.editorKind === "string" &&
    value.editorKind.length <= 80 &&
    Number.isFinite(value.capturedAt)
  );
}

export function crossOjResponse(
  requestId: string,
  ok: boolean,
  code: string,
  extras: Partial<
    Omit<CrossOjResponse, "schemaVersion" | "requestId" | "ok" | "code">
  > = {},
): CrossOjResponse {
  return {
    schemaVersion: CROSS_OJ_SCHEMA_VERSION,
    requestId,
    ok,
    code,
    ...extras,
  };
}

function responseUrlHasOrigin(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isCrossOjResponse(
  value: unknown,
  requestId: string,
): value is CrossOjResponse {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === CROSS_OJ_SCHEMA_VERSION &&
    value.requestId === requestId &&
    typeof value.ok === "boolean" &&
    typeof value.code === "string" &&
    (value.targetUrl === undefined ||
      (typeof value.targetUrl === "string" &&
        value.targetUrl.length <= 2048 &&
        responseUrlHasOrigin(value.targetUrl, "https://codeforces.com"))) &&
    (value.returnUrl === undefined ||
      (typeof value.returnUrl === "string" &&
        value.returnUrl.length <= 2048 &&
        responseUrlHasOrigin(value.returnUrl, "https://www.luogu.com.cn"))) &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.editor === undefined || isEditorSnapshot(value.editor)) &&
    (value.languageOptions === undefined ||
      (Array.isArray(value.languageOptions) &&
        value.languageOptions.every(
          (option) =>
            isRecord(option) &&
            typeof option.value === "string" &&
            typeof option.label === "string",
        )))
  );
}
