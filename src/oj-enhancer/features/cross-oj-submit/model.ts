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

export type ProblemHistoryStatus =
  "accepted" | "unaccepted" | "none" | "unavailable";

export interface CrossOjTestCaseDetail {
  index: number;
  verdict?: string;
  timeMs?: number;
  memoryBytes?: number;
  exitCode?: number;
  checkerExitCode?: number;
  input?: string;
  output?: string;
  answer?: string;
  checkerLog?: string;
}

/** Bounded, locally stored detail captured from an official submission page. */
export interface CrossOjSubmissionDetail {
  oj: "codeforces" | "atcoder";
  submissionId: string;
  problemId: string;
  detailUrl: string;
  observedAt: number;
  evaluationStatus: CrossOjEvaluationStatus;
  rawVerdict?: string;
  username?: string;
  problemName?: string;
  language?: string;
  submittedAt?: string;
  judgedAt?: string;
  timeMs?: number;
  memoryBytes?: number;
  passedTestCount?: number;
  score?: number;
  sourceCode?: string;
  tests: CrossOjTestCaseDetail[];
  truncated: boolean;
}

export interface CrossOjSubmissionRecord {
  oj: CrossOjProblemRef["oj"];
  submissionId: string;
  problemId: string;
  detailUrl: string;
  observedAt: number;
  evaluationStatus: CrossOjEvaluationStatus;
  rawVerdict?: string;
  statusUpdatedAt: number;
}

/** A fresh, bounded record row returned for the Luogu-style cross-OJ list. */
export interface CrossOjRecordListItem extends CrossOjSubmissionRecord {
  accountName?: string;
  problemName?: string;
  language?: string;
  score?: number;
  timeMs?: number;
  memoryBytes?: number;
  codeLength?: number;
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
      type: "SAVE_CROSS_OJ_DETAIL";
      detail: CrossOjSubmissionDetail;
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "GET_CROSS_OJ_DETAIL";
      submissionId: string;
      oj?: CrossOjSubmissionRecord["oj"];
      pageUrl?: string;
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "GET_CROSS_OJ_RECORDS";
      problem: CrossOjProblemRef;
      pageUrl?: string;
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "REFRESH_CROSS_OJ_RECORDS";
      problem: CrossOjProblemRef;
      continueScan?: boolean;
      pageUrl?: string;
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "GET_CODEFORCES_PROBLEM_STATUS";
      problem: ProblemRef;
    }
  | {
      schemaVersion: typeof CROSS_OJ_SCHEMA_VERSION;
      requestId: string;
      type: "GET_ATCODER_PROBLEM_STATUS";
      problem: AtCoderProblemRef;
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
  problem?: CrossOjProblemRef;
  problemStatus?: ProblemHistoryStatus;
  problemStatusMessage?: string;
  targetTabId?: number;
  sourceDetailUrl?: string;
  record?: CrossOjRecordListItem;
  records?: CrossOjRecordListItem[];
  recordsMessage?: string;
  recordScanHasMore?: boolean;
  languageOptions?: Array<{ value: string; label: string }>;
  taskState?: CrossOjTaskState;
  result?: CrossOjSubmitTask["result"];
  detail?: CrossOjSubmissionDetail;
  recordInstalled?: boolean;
  editor?: EditorSnapshot;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function isOptionalLuoguPageUrl(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || !value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.origin === "https://www.luogu.com.cn" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

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
    case "SAVE_CROSS_OJ_DETAIL":
      return isCrossOjSubmissionDetail(value.detail);
    case "GET_CROSS_OJ_DETAIL":
      return (
        typeof value.submissionId === "string" &&
        /^\d{1,20}$/.test(value.submissionId) &&
        (value.oj === undefined ||
          value.oj === "codeforces" ||
          value.oj === "atcoder") &&
        isOptionalLuoguPageUrl(value.pageUrl)
      );
    case "GET_CROSS_OJ_RECORDS":
      return (
        isProblemRef(value.problem) && isOptionalLuoguPageUrl(value.pageUrl)
      );
    case "REFRESH_CROSS_OJ_RECORDS":
      return (
        isProblemRef(value.problem) &&
        (value.continueScan === undefined ||
          typeof value.continueScan === "boolean") &&
        isOptionalLuoguPageUrl(value.pageUrl)
      );
    case "GET_CODEFORCES_PROBLEM_STATUS":
      return isProblemRef(value.problem) && value.problem.oj === "codeforces";
    case "GET_ATCODER_PROBLEM_STATUS":
      return isProblemRef(value.problem) && value.problem.oj === "atcoder";
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

export function isCrossOjSubmissionDetail(
  value: unknown,
): value is CrossOjSubmissionDetail {
  if (!isRecord(value)) return false;
  const detail = value as Partial<CrossOjSubmissionDetail>;
  const textBudget =
    (typeof detail.sourceCode === "string" ? detail.sourceCode.length : 0) +
    (Array.isArray(detail.tests)
      ? detail.tests.reduce(
          (sum, test) =>
            sum +
            ["input", "output", "answer", "checkerLog"].reduce(
              (fieldSum, key) =>
                fieldSum +
                (isRecord(test) && typeof test[key] === "string"
                  ? (test[key] as string).length
                  : 0),
              0,
            ),
          0,
        )
      : 0);
  return (
    (detail.oj === "codeforces" || detail.oj === "atcoder") &&
    typeof detail.submissionId === "string" &&
    /^\d{1,20}$/.test(detail.submissionId) &&
    typeof detail.problemId === "string" &&
    detail.problemId.length <= 80 &&
    typeof detail.detailUrl === "string" &&
    detail.detailUrl.length <= 2048 &&
    Number.isFinite(detail.observedAt) &&
    (detail.evaluationStatus === "judging" ||
      detail.evaluationStatus === "accepted" ||
      detail.evaluationStatus === "rejected" ||
      detail.evaluationStatus === "unknown") &&
    (detail.rawVerdict === undefined ||
      (typeof detail.rawVerdict === "string" &&
        detail.rawVerdict.length <= 120)) &&
    (detail.username === undefined ||
      (typeof detail.username === "string" && detail.username.length <= 80)) &&
    (detail.problemName === undefined ||
      (typeof detail.problemName === "string" &&
        detail.problemName.length <= 240)) &&
    (detail.language === undefined ||
      (typeof detail.language === "string" && detail.language.length <= 120)) &&
    (detail.submittedAt === undefined ||
      (typeof detail.submittedAt === "string" &&
        detail.submittedAt.length <= 80)) &&
    (detail.judgedAt === undefined ||
      (typeof detail.judgedAt === "string" && detail.judgedAt.length <= 80)) &&
    (detail.timeMs === undefined ||
      (Number.isSafeInteger(detail.timeMs) && detail.timeMs >= 0)) &&
    (detail.memoryBytes === undefined ||
      (Number.isSafeInteger(detail.memoryBytes) && detail.memoryBytes >= 0)) &&
    (detail.passedTestCount === undefined ||
      (Number.isSafeInteger(detail.passedTestCount) &&
        detail.passedTestCount >= 0)) &&
    (detail.score === undefined ||
      (typeof detail.score === "number" && Number.isFinite(detail.score))) &&
    (detail.sourceCode === undefined ||
      (typeof detail.sourceCode === "string" &&
        detail.sourceCode.length <= 120_000)) &&
    Array.isArray(detail.tests) &&
    detail.tests.length <= 200 &&
    textBudget <= 180_000 &&
    detail.tests.every(
      (test) =>
        isRecord(test) &&
        Number.isSafeInteger(test.index) &&
        test.index > 0 &&
        (test.verdict === undefined ||
          (typeof test.verdict === "string" && test.verdict.length <= 120)) &&
        (test.timeMs === undefined ||
          (Number.isSafeInteger(test.timeMs) && test.timeMs >= 0)) &&
        (test.memoryBytes === undefined ||
          (Number.isSafeInteger(test.memoryBytes) && test.memoryBytes >= 0)) &&
        (test.exitCode === undefined || Number.isSafeInteger(test.exitCode)) &&
        (test.checkerExitCode === undefined ||
          Number.isSafeInteger(test.checkerExitCode)) &&
        ["input", "output", "answer", "checkerLog"].every(
          (key) =>
            test[key] === undefined ||
            (typeof test[key] === "string" && test[key].length <= 20_000),
        ),
    ) &&
    typeof detail.truncated === "boolean"
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
        (responseUrlHasOrigin(value.targetUrl, "https://codeforces.com") ||
          responseUrlHasOrigin(value.targetUrl, "https://atcoder.jp")))) &&
    (value.returnUrl === undefined ||
      (typeof value.returnUrl === "string" &&
        value.returnUrl.length <= 2048 &&
        responseUrlHasOrigin(value.returnUrl, "https://www.luogu.com.cn"))) &&
    (value.sourceDetailUrl === undefined ||
      (typeof value.sourceDetailUrl === "string" &&
        value.sourceDetailUrl.length <= 2048 &&
        (responseUrlHasOrigin(
          value.sourceDetailUrl,
          "https://codeforces.com",
        ) ||
          responseUrlHasOrigin(
            value.sourceDetailUrl,
            "https://atcoder.jp",
          )))) &&
    (value.record === undefined || isCrossOjRecordListItem(value.record)) &&
    (value.records === undefined ||
      (Array.isArray(value.records) &&
        value.records.length <= 1000 &&
        value.records.every(isCrossOjRecordListItem))) &&
    (value.recordsMessage === undefined ||
      (typeof value.recordsMessage === "string" &&
        value.recordsMessage.length <= 240)) &&
    (value.recordScanHasMore === undefined ||
      typeof value.recordScanHasMore === "boolean") &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.problem === undefined || isProblemRef(value.problem)) &&
    (value.problemStatus === undefined ||
      value.problemStatus === "accepted" ||
      value.problemStatus === "unaccepted" ||
      value.problemStatus === "none" ||
      value.problemStatus === "unavailable") &&
    (value.problemStatusMessage === undefined ||
      (typeof value.problemStatusMessage === "string" &&
        value.problemStatusMessage.length <= 240)) &&
    (value.detail === undefined || isCrossOjSubmissionDetail(value.detail)) &&
    (value.recordInstalled === undefined ||
      typeof value.recordInstalled === "boolean") &&
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

export function isCrossOjRecordListItem(
  value: unknown,
): value is CrossOjRecordListItem {
  if (!isRecord(value)) return false;
  const item = value as Partial<CrossOjRecordListItem>;
  return (
    (item.oj === "codeforces" || item.oj === "atcoder") &&
    typeof item.submissionId === "string" &&
    /^\d{1,20}$/.test(item.submissionId) &&
    typeof item.problemId === "string" &&
    item.problemId.length > 0 &&
    item.problemId.length <= 120 &&
    typeof item.detailUrl === "string" &&
    item.detailUrl.length <= 2048 &&
    Number.isFinite(item.observedAt) &&
    Number.isFinite(item.statusUpdatedAt) &&
    (item.evaluationStatus === "judging" ||
      item.evaluationStatus === "accepted" ||
      item.evaluationStatus === "rejected" ||
      item.evaluationStatus === "unknown") &&
    (item.rawVerdict === undefined ||
      (typeof item.rawVerdict === "string" && item.rawVerdict.length <= 120)) &&
    (item.accountName === undefined ||
      (typeof item.accountName === "string" &&
        item.accountName.length <= 80)) &&
    (item.problemName === undefined ||
      (typeof item.problemName === "string" &&
        item.problemName.length <= 240)) &&
    (item.language === undefined ||
      (typeof item.language === "string" && item.language.length <= 120)) &&
    (item.score === undefined ||
      (typeof item.score === "number" && Number.isFinite(item.score))) &&
    (item.timeMs === undefined ||
      (Number.isSafeInteger(item.timeMs) && item.timeMs >= 0)) &&
    (item.memoryBytes === undefined ||
      (Number.isSafeInteger(item.memoryBytes) && item.memoryBytes >= 0)) &&
    (item.codeLength === undefined ||
      (Number.isSafeInteger(item.codeLength) && item.codeLength >= 0))
  );
}
