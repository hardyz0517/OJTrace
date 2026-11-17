import {
  CROSS_OJ_SCHEMA_VERSION,
  isCrossOjResponse,
  type CrossOjResponse,
  type CrossOjCommand,
  type CrossOjProblemRef,
} from "../src/oj-enhancer/features/cross-oj-submit/model";
import { createLuoguPageAccessGate } from "../src/oj-enhancer/features/cross-oj-submit/luogu-page-access";
import { readLuoguPageProblemContextInPage } from "../src/oj-enhancer/features/cross-oj-submit/luogu-page-context";
import { resolveLuoguProblem } from "../src/oj-enhancer/features/cross-oj-submit/luogu-problem";
import {
  inspectLuoguNativeSubmitUi,
  insertLuoguCrossOjEntry,
  LUOGU_CROSS_OJ_ENTRY_ID,
  observeLuoguSubmitUiChanges,
  updateLuoguCrossOjStatus,
} from "../src/oj-enhancer/features/cross-oj-submit/luogu-page-entry";
import { mountLuoguCrossOjRecordList } from "../src/oj-enhancer/features/cross-oj-submit/record-list";
import {
  LuoguProblemHistoryStatusController,
  observeLuoguProblemHistoryChanges,
  renderLuoguProblemHistoryStatus,
} from "../src/oj-enhancer/features/cross-oj-submit/luogu-problem-history";

import { legacyLuoguRecordDetailUrl } from "../src/oj-enhancer/features/cross-oj-submit/record-links";
import { watchLuoguLocationChanges } from "../src/oj-enhancer/features/cross-oj-submit/luogu-location";

const LUOGU_CROSS_OJ_CONTROLLER_ATTRIBUTE = "data-ojtrace-luogu-controller";
const LUOGU_CROSS_OJ_CONTROLLER_TAKEOVER_EVENT =
  "ojtrace:luogu-controller-takeover";
const pageAccessGate = createLuoguPageAccessGate();
const problemHistoryController = new LuoguProblemHistoryStatusController(
  (status) => renderLuoguProblemHistoryStatus(status),
);
const PAGE_INSTANCE_KEY = "__ojtraceLuoguCrossOjPageInstance";
const DIAGNOSTIC_ENABLED_ATTRIBUTE = "data-ojtrace-cross-oj-debug";
const DIAGNOSTIC_ATTRIBUTE = "data-ojtrace-cross-oj-diagnostic";
const DIAGNOSTIC_HISTORY_LIMIT = 20;
const diagnosticHistory: Array<Record<string, unknown>> = [];
let lastDiagnosticSignature = "";
let activeRecordViewKey = "";
let activeRecordViewDispose: (() => void) | undefined;
let controllerIsCurrent = (): boolean => true;

function recordDiagnostic(
  stage: string,
  detail: Record<string, unknown> = {},
): void {
  if (
    document.documentElement?.getAttribute(DIAGNOSTIC_ENABLED_ATTRIBUTE) !== "1"
  )
    return;
  const snapshot = {
    stage,
    readyState: document.readyState,
    onProblemRoute: /^\/problem\/[^/]+\/?$/.test(location.pathname),
    submitPanelSelected: location.hash === "#submit",
    pageContextPresent: Boolean(
      document.querySelector("script#lentille-context"),
    ),
    entryPresent: Boolean(document.getElementById(LUOGU_CROSS_OJ_ENTRY_ID)),
    ...detail,
  };
  const signature = JSON.stringify(snapshot);
  if (signature === lastDiagnosticSignature) return;
  lastDiagnosticSignature = signature;
  diagnosticHistory.push({ at: Date.now(), ...snapshot });
  if (diagnosticHistory.length > DIAGNOSTIC_HISTORY_LIMIT)
    diagnosticHistory.splice(
      0,
      diagnosticHistory.length - DIAGNOSTIC_HISTORY_LIMIT,
    );
  const diagnostic = JSON.stringify(diagnosticHistory);
  document.documentElement?.setAttribute(DIAGNOSTIC_ATTRIBUTE, diagnostic);
  console.info("[OJTrace] Luogu cross-OJ diagnostic", snapshot);
}

function currentProblem():
  { problemId: string; problem: CrossOjProblemRef } | undefined {
  return resolveLuoguProblem(
    location.href,
    readLuoguPageProblemContextInPage(),
  );
}

async function send(command: CrossOjCommand): Promise<CrossOjResponse> {
  const requestId = crypto.randomUUID();
  const response: unknown = await browser.runtime.sendMessage({
    ...command,
    schemaVersion: CROSS_OJ_SCHEMA_VERSION,
    requestId,
  });
  if (!isCrossOjResponse(response, requestId)) {
    throw new Error("扩展后台没有返回有效结果，请重新启用页面按钮。");
  }
  if (!response.ok) {
    recordDiagnostic("background-rejected", {
      command: command.type,
      responseCode: response.code,
    });
    throw new Error(response.message ?? "跨 OJ 操作失败。");
  }
  recordDiagnostic("background-accepted", {
    command: command.type,
    responseCode: response.code,
  });
  return response;
}

function installEntry(native: HTMLButtonElement): void {
  if (document.getElementById(LUOGU_CROSS_OJ_ENTRY_ID)) return;
  const current = currentProblem();
  if (!current) return;
  insertLuoguCrossOjEntry(native, current.problem, (entry, event) => {
    if (!event.isTrusted || entry.disabled) return;
    void (async () => {
      entry.disabled = true;
      const status = updateLuoguCrossOjStatus(
        current.problem.oj === "codeforces"
          ? "正在读取代码并向 Codeforces 提交…"
          : "正在读取代码并向 AtCoder 提交…",
      );
      try {
        const capture = (await send({ type: "CAPTURE_CROSS_OJ_EDITOR" })) as {
          editor?: {
            code: string;
            luoguLanguage: string;
            editorKind: string;
            capturedAt: number;
          };
        };
        const editor = capture.editor;
        if (!editor) throw new Error("未能读取洛谷代码，请确认代码框已加载。");
        const created = await send({
          type: "CREATE_CROSS_OJ_TASK",
          problem: current.problem,
          editor,
        });
        if (typeof created.targetUrl === "string") {
          status.textContent =
            current.problem.oj === "codeforces"
              ? "正在加载 Codeforces 提交与验证界面…"
              : "正在加载 AtCoder 提交与验证界面…";
          location.assign(created.targetUrl);
          return;
        }
        status.textContent =
          current.problem.oj === "codeforces"
            ? "已打开 Codeforces 提交页，正在提交代码；请查看目标页面上的提交状态。"
            : "AtCoder 提交页已打开，正在提交代码；请查看目标页面上的提交状态。";
        status.style.color = "#237547";
      } catch (error) {
        status.textContent =
          error instanceof Error ? error.message : "跨 OJ 操作失败，请重试。";
      } finally {
        entry.disabled = false;
      }
    })();
  });
}

function problemKey(
  problem: NonNullable<ReturnType<typeof currentProblem>>,
): string {
  const pageUrl = new URL(location.href);
  return `${pageUrl.origin}${pageUrl.pathname}:${problem.problemId}:${JSON.stringify(problem.problem)}`;
}

function syncProblemHistoryStatus(
  current: NonNullable<ReturnType<typeof currentProblem>> | undefined,
): void {
  if (!current) {
    problemHistoryController.sync(undefined);
    return;
  }

  const problem = current.problem;
  const sourceName = problem.oj === "codeforces" ? "Codeforces" : "AtCoder";
  const key = problemKey(current);
  problemHistoryController.sync(
    key,
    async () => {
      const response =
        problem.oj === "codeforces"
          ? await send({
              type: "GET_CODEFORCES_PROBLEM_STATUS",
              problem,
            })
          : await send({
              type: "GET_ATCODER_PROBLEM_STATUS",
              problem,
            });
      if (!response.problemStatus)
        throw new Error(`${sourceName} 未返回该题目的提交状态。`);
      return {
        status: response.problemStatus,
        ...(response.problemStatusMessage
          ? { message: response.problemStatusMessage }
          : {}),
      };
    },
    sourceName,
  );
}

function checkPageAccess(
  problem: NonNullable<ReturnType<typeof currentProblem>>,
): void {
  const key = problemKey(problem);
  pageAccessGate.check(
    key,
    async () => {
      recordDiagnostic("page-access-check-started", {
        access: "checking",
        problemId: problem.problemId,
        targetOj: problem.problem.oj,
      });
      try {
        const response = await send({
          type: "CHECK_CROSS_OJ_PAGE_ACCESS",
          problem: problem.problem,
        });
        const allowed = response.code === "page-access-allowed";
        recordDiagnostic("page-access-check-finished", {
          access: allowed ? "allowed" : "retrying",
          responseCode: response.code,
        });
        return allowed;
      } catch (error) {
        recordDiagnostic("page-access-check-error", {
          access: "retrying",
          errorType: error instanceof Error ? error.name : "unknown",
        });
        throw error;
      }
    },
    () => problemKey(problem) === key,
    reconcile,
  );
}

function disposeActiveRecordView(): void {
  activeRecordViewDispose?.();
  activeRecordViewDispose = undefined;
  activeRecordViewKey = "";
}

function mountRecordView(key: string, mount: () => () => void): void {
  if (activeRecordViewKey === key && activeRecordViewDispose) return;
  disposeActiveRecordView();
  activeRecordViewKey = key;
  activeRecordViewDispose = mount();
}

function reconcile(): void {
  const legacyDetailUrl = legacyLuoguRecordDetailUrl(location.href);
  if (legacyDetailUrl) {
    location.replace(legacyDetailUrl);
    return;
  }
  const existing = document.getElementById(LUOGU_CROSS_OJ_ENTRY_ID);
  const current = currentProblem();
  const onProblemRoute = /^\/problem\/[^/]+\/?$/.test(location.pathname);
  syncProblemHistoryStatus(onProblemRoute ? current : undefined);
  if (
    location.pathname === "/record/list" &&
    current &&
    (current.problem.oj === "codeforces" || current.problem.oj === "atcoder")
  ) {
    existing?.remove();
    const listUrl = new URL(location.href);
    listUrl.hash = "";
    mountRecordView(`list:${listUrl.href}`, () =>
      mountLuoguCrossOjRecordList(
        current.problem,
        () =>
          send({
            type: "GET_CROSS_OJ_RECORDS",
            problem: current.problem,
            pageUrl: location.href,
          }),
        (continueScan = false) =>
          send({
            type: "REFRESH_CROSS_OJ_RECORDS",
            problem: current.problem,
            pageUrl: location.href,
            ...(continueScan ? { continueScan: true } : {}),
          }),
        current.problemId,
        () =>
          send({
            type: "GET_CROSS_OJ_PROBLEM_DIFFICULTY",
            problem: current.problem,
            pageUrl: location.href,
          }),
      ),
    );
    return;
  }

  disposeActiveRecordView();
  const nativeUi = inspectLuoguNativeSubmitUi();
  const native = current ? nativeUi.nativeButton : undefined;
  const problemDetails = current
    ? { problemId: current.problemId, targetOj: current.problem.oj }
    : { problemId: null, targetOj: null };
  if (!current || !native) {
    existing?.remove();
    recordDiagnostic(
      !current ? "problem-not-resolved" : "native-submit-not-ready",
      {
        problemRecognized: Boolean(current),
        ...problemDetails,
        nativeSubmit: {
          fileUploaderVisible: nativeUi.fileUploaderVisible,
          candidateCount: nativeUi.candidateCount,
          visibleCandidateCount: nativeUi.visibleCandidateCount,
          candidateSizes: nativeUi.candidateSizes,
        },
      },
    );
    return;
  }
  const key = problemKey(current);
  if (!pageAccessGate.hasAccess(key)) {
    existing?.remove();
    recordDiagnostic("page-access-pending", {
      problemRecognized: true,
      ...problemDetails,
      nativeSubmit: {
        fileUploaderVisible: nativeUi.fileUploaderVisible,
        candidateCount: nativeUi.candidateCount,
        visibleCandidateCount: nativeUi.visibleCandidateCount,
        candidateSizes: nativeUi.candidateSizes,
      },
    });
    checkPageAccess(current);
    return;
  }
  if (existing && existing.previousElementSibling !== native) existing.remove();
  installEntry(native);
  recordDiagnostic("entry-installed", { problemRecognized: true });
}

export default defineContentScript({
  matches: ["https://www.luogu.com.cn/*"],
  runAt: "document_start",
  main(ctx) {
    if (window.top !== window) return;
    recordDiagnostic("content-script-started");
    const pageWindow = window as Window & {
      [PAGE_INSTANCE_KEY]?: string;
    };
    if (pageWindow[PAGE_INSTANCE_KEY]) return;
    const controllerToken = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}`;
    let disposed = false;
    const onTakeover = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === controllerToken) disposeController();
    };
    window.addEventListener(
      LUOGU_CROSS_OJ_CONTROLLER_TAKEOVER_EVENT,
      onTakeover,
    );
    const previousController = document.documentElement?.getAttribute(
      LUOGU_CROSS_OJ_CONTROLLER_ATTRIBUTE,
    );
    document.documentElement?.setAttribute(
      LUOGU_CROSS_OJ_CONTROLLER_ATTRIBUTE,
      controllerToken,
    );
    if (previousController && previousController !== controllerToken) {
      window.dispatchEvent(
        new CustomEvent(LUOGU_CROSS_OJ_CONTROLLER_TAKEOVER_EVENT, {
          detail: previousController,
        }),
      );
    }
    pageWindow[PAGE_INSTANCE_KEY] = controllerToken;
    controllerIsCurrent = () =>
      !disposed &&
      document.documentElement?.getAttribute(
        LUOGU_CROSS_OJ_CONTROLLER_ATTRIBUTE,
      ) === controllerToken;
    let reconciliationFrame: number | undefined;
    const scheduleReconcile = () => {
      if (
        disposed ||
        !controllerIsCurrent() ||
        reconciliationFrame !== undefined
      )
        return;
      reconciliationFrame = window.requestAnimationFrame(() => {
        reconciliationFrame = undefined;
        if (controllerIsCurrent()) reconcile();
      });
    };
    const observer = observeLuoguSubmitUiChanges(scheduleReconcile);
    const historyObserver =
      observeLuoguProblemHistoryChanges(scheduleReconcile);
    const stopLocationWatch = watchLuoguLocationChanges(scheduleReconcile);
    ctx.addEventListener(window, "hashchange", scheduleReconcile);
    ctx.addEventListener(window, "popstate", scheduleReconcile);
    ctx.addEventListener(window, "wxt:locationchange", scheduleReconcile);
    ctx.addEventListener(window, "ojtrace:cross-oj-debug", scheduleReconcile);

    function disposeController(): void {
      if (disposed) return;
      disposeActiveRecordView();
      disposed = true;
      if (controllerIsCurrent()) controllerIsCurrent = () => false;
      window.removeEventListener(
        LUOGU_CROSS_OJ_CONTROLLER_TAKEOVER_EVENT,
        onTakeover,
      );
      if (pageWindow[PAGE_INSTANCE_KEY] === controllerToken)
        delete pageWindow[PAGE_INSTANCE_KEY];
      if (
        document.documentElement?.getAttribute(
          LUOGU_CROSS_OJ_CONTROLLER_ATTRIBUTE,
        ) === controllerToken
      )
        document.documentElement.removeAttribute(
          LUOGU_CROSS_OJ_CONTROLLER_ATTRIBUTE,
        );
      if (reconciliationFrame !== undefined)
        window.cancelAnimationFrame(reconciliationFrame);
      observer.disconnect();
      historyObserver.disconnect();
      stopLocationWatch();
      problemHistoryController.sync(undefined);
      pageAccessGate.dispose();
      document.getElementById(LUOGU_CROSS_OJ_ENTRY_ID)?.remove();
      document
        .querySelectorAll("[data-ojtrace-cross-oj-status]")
        .forEach((node) => node.remove());
      document.documentElement?.removeAttribute(DIAGNOSTIC_ATTRIBUTE);
      document.documentElement?.removeAttribute(DIAGNOSTIC_ENABLED_ATTRIBUTE);
    }
    ctx.onInvalidated(() => {
      disposeController();
    });
    reconcile();
  },
});
