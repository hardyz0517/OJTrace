import {
  CROSS_OJ_SCHEMA_VERSION,
  isCrossOjResponse,
  type CrossOjCommand,
  type CrossOjEvaluationStatus,
  type CrossOjResponse,
} from "../src/oj-enhancer/features/cross-oj-submit/model";
import {
  codeforcesSubmissionFromUrl,
  parseCodeforcesProblemUrl,
  parseCodeforcesSubmitUrl,
} from "../src/oj-enhancer/features/cross-oj-submit/problem";
import {
  codeforcesEvaluationFromPage,
  pollAndReportEvaluation,
} from "../src/oj-enhancer/features/cross-oj-submit/evaluation";
import { safeLuoguReturnUrl } from "../src/oj-enhancer/features/cross-oj-submit/record-links";
import {
  hideCrossOjSubmitMask,
  showCrossOjSubmitMask,
} from "../src/oj-enhancer/features/cross-oj-submit/submit-mask";

const BANNER_ID = "ojtrace-cross-oj-submit-banner";
const CODEFORCES_FLOW_SESSION_KEY = "ojtrace:codeforces:cross-oj-flow";
const CODEFORCES_FLOW_TTL_MS = 10 * 60_000;
let codeforcesCrossOjFlow = false;

function saveCrossOjFlowMarker(): boolean {
  const route = parseCodeforcesSubmitUrl(location.href);
  if (
    route?.kind === "submit" &&
    new URL(location.href).searchParams.get("ojtrace") === "1"
  ) {
    try {
      sessionStorage.setItem(
        CODEFORCES_FLOW_SESSION_KEY,
        JSON.stringify({ startedAt: Date.now() }),
      );
    } catch {
      // The explicit URL marker still identifies this first document.
    }
    return true;
  }
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(CODEFORCES_FLOW_SESSION_KEY) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { startedAt?: unknown }).startedAt === "number"
    ) {
      const startedAt = (value as { startedAt: number }).startedAt;
      if (
        startedAt <= Date.now() + 30_000 &&
        Date.now() - startedAt < CODEFORCES_FLOW_TTL_MS
      )
        return true;
    }
    sessionStorage.removeItem(CODEFORCES_FLOW_SESSION_KEY);
  } catch {
    // Session storage may be disabled; use the current URL marker only.
  }
  return false;
}

function clearCrossOjFlowMarker(): void {
  try {
    sessionStorage.removeItem(CODEFORCES_FLOW_SESSION_KEY);
  } catch {
    // Ignore unavailable session storage.
  }
}

function hasCrossOjFlowMarker(): boolean {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(CODEFORCES_FLOW_SESSION_KEY) ?? "null",
    );
    const startedAt =
      value && typeof value === "object"
        ? (value as { startedAt?: unknown }).startedAt
        : undefined;
    return (
      typeof startedAt === "number" &&
      startedAt <= Date.now() + 30_000 &&
      Date.now() - startedAt < CODEFORCES_FLOW_TTL_MS
    );
  } catch {
    return false;
  }
}

function waitForDocumentReady(): Promise<void> {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", () => resolve(), {
      once: true,
    });
  });
}

function requestId(): string {
  return crypto.randomUUID();
}

async function send(
  command: CrossOjCommand,
): Promise<CrossOjResponse | undefined> {
  try {
    const id = requestId();
    const response: unknown = await browser.runtime.sendMessage({
      ...command,
      schemaVersion: CROSS_OJ_SCHEMA_VERSION,
      requestId: id,
    });
    if (!isCrossOjResponse(response, id)) return undefined;
    return response;
  } catch {
    return undefined;
  }
}

function profileLabel(): string {
  const profile = document.querySelector<HTMLAnchorElement>(
    '#header a[href^="/profile/"], header a[href^="/profile/"]',
  );
  if (!profile) return "请在 Codeforces 页面确认当前账号";
  const handle = profile.pathname.split("/").filter(Boolean).at(-1);
  return handle
    ? `当前 Codeforces 账号：${decodeURIComponent(handle)}`
    : "请确认当前 Codeforces 账号";
}

function showBanner(
  message: string,
  action?: { label: string; href: string },
): void {
  hideCrossOjSubmitMask();
  if (codeforcesCrossOjFlow) {
    clearCrossOjFlowMarker();
    codeforcesCrossOjFlow = false;
  }
  document.getElementById(BANNER_ID)?.remove();
  const banner = document.createElement("section");
  banner.id = BANNER_ID;
  banner.setAttribute("role", "status");
  Object.assign(banner.style, {
    position: "fixed",
    zIndex: "2147483647",
    inset: "12px 12px auto auto",
    maxWidth: "min(440px, calc(100vw - 24px))",
    padding: "14px 16px",
    color: "#1c2430",
    background: "#fff",
    border: "1px solid #cbd4e1",
    borderRadius: "10px",
    boxShadow: "0 8px 28px #0003",
    font: "14px/1.5 system-ui, sans-serif",
  });
  const account = document.createElement("div");
  account.textContent = profileLabel();
  account.style.fontWeight = "700";
  account.style.marginBottom = "6px";
  const text = document.createElement("div");
  text.textContent = message;
  banner.append(account, text);
  if (action) {
    const link = document.createElement("a");
    link.href = action.href;
    link.textContent = action.label;
    link.style.marginLeft = "8px";
    link.style.color = "#1769aa";
    banner.append(link);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "关闭提示";
  close.style.marginLeft = "8px";
  close.addEventListener("click", () => banner.remove());
  banner.append(close);
  document.documentElement.append(banner);
}

function showFlowStatus(message: string): void {
  if (codeforcesCrossOjFlow) showCrossOjSubmitMask("codeforces", message);
  else showBanner(message);
}

function problemLinkInPage(): ReturnType<typeof parseCodeforcesProblemUrl> {
  const problems = new Map<
    string,
    NonNullable<ReturnType<typeof parseCodeforcesProblemUrl>>
  >();
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/problem/"]',
  )) {
    const problem = parseCodeforcesProblemUrl(link.href);
    if (problem) problems.set(`${problem.contestId}/${problem.index}`, problem);
  }
  return problems.size === 1 ? [...problems.values()][0] : undefined;
}

function evaluationLabel(status: CrossOjEvaluationStatus): string {
  if (status === "accepted") return "评测结果：Accepted";
  if (status === "rejected") return "评测已结束，请在 Codeforces 查看具体结果";
  if (status === "unknown")
    return "已识别提交，评测状态暂时无法确认，请在 Codeforces 查看详情。";
  return "评测仍在进行；OJTrace 会在一分钟内有限检查页面状态";
}

async function syncEvaluation(
  submissionId: string,
  showStatus = false,
): Promise<void> {
  const detailUrl = location.href;
  if (showStatus)
    showBanner(
      `提交 #${submissionId} 已识别，可在当前 Codeforces 页面查看详情。`,
    );
  await pollAndReportEvaluation({
    isCurrentPage: () => location.href === detailUrl,
    readStatus: codeforcesEvaluationFromPage,
    report: async (evaluationStatus) => {
      const response = await send({
        type: "UPDATE_CROSS_OJ_EVALUATION",
        submissionId,
        detailUrl,
        evaluationStatus,
      });
      return response?.ok === true && response.code === "evaluation-updated";
    },
    onReported: (status) => {
      if (showStatus) showBanner(evaluationLabel(status));
    },
  });
}

async function inspectResult(): Promise<boolean> {
  const submission = codeforcesSubmissionFromUrl(location.href);
  if (!submission) return false;
  const submitReferrer = parseCodeforcesSubmitUrl(document.referrer);
  if (submitReferrer?.kind !== "submit") {
    const problem = problemLinkInPage();
    if (problem) {
      const resumed = await send({
        type: "UPDATE_CROSS_OJ_TASK",
        event: {
          kind: "result-observed",
          submissionId: submission.submissionId,
          detailUrl: location.href,
          contestId: problem.contestId,
          index: problem.index,
          submitReferrer: sanitizedResultReferrer(),
        },
      });
      if (resumed?.ok && resumed.code === "completed") {
        showFlowStatus(
          `提交 #${submission.submissionId} 已识别，正在读取评测状态。`,
        );
        syncEvaluation(submission.submissionId, true);
        return true;
      }
      if (codeforcesCrossOjFlow) {
        showBanner(
          `发现 Codeforces 提交 #${submission.submissionId}，但无法确认它属于本次洛谷操作。请核对当前 CF 记录。`,
        );
        return true;
      }
    }
    if (codeforcesCrossOjFlow) {
      const response = await send({
        type: "UPDATE_CROSS_OJ_TASK",
        event: { kind: "result-unmatched" },
      });
      const destination =
        response?.ok && response.code === "result-unknown"
          ? safeLuoguReturnUrl(response.returnUrl)
          : undefined;
      showBanner(
        `Codeforces 提交 #${submission.submissionId} 的题目信息无法读取，自动关联已停止。请核对 CF 记录。`,
        destination
          ? { label: "手动返回洛谷题目页", href: destination }
          : undefined,
      );
      return true;
    }
    // A restored detail page can finish an already observed result task or
    // update an existing history entry; it cannot create a new association.
    syncEvaluation(submission.submissionId);
    return true;
  }
  await send({
    type: "UPDATE_CROSS_OJ_TASK",
    event: { kind: "submit-observed", submitUrl: document.referrer },
  });
  const problem = problemLinkInPage();
  if (!problem) {
    const response = await send({
      type: "UPDATE_CROSS_OJ_TASK",
      event: { kind: "result-unmatched" },
    });
    if (!codeforcesCrossOjFlow) return false;
    const destination =
      response?.ok && response.code === "result-unknown"
        ? safeLuoguReturnUrl(response.returnUrl)
        : undefined;
    showBanner(
      response?.ok && response.code === "result-unknown"
        ? `已观察到 Codeforces 提交 #${submission.submissionId}，但无法可靠确认题号归属。请核对 CF 记录。`
        : `OJTrace 无法确认 Codeforces 提交 #${submission.submissionId} 的题目归属。请核对 CF 记录。`,
      destination
        ? { label: "手动返回洛谷题目页", href: destination }
        : undefined,
    );
    return true;
  }
  const response = await send({
    type: "UPDATE_CROSS_OJ_TASK",
    event: {
      kind: "result-observed",
      submissionId: submission.submissionId,
      detailUrl: location.href,
      contestId: problem.contestId,
      index: problem.index,
      submitReferrer: sanitizedResultReferrer(),
    },
  });
  if (!response?.ok || response.code !== "completed") {
    if (!codeforcesCrossOjFlow) return false;
    showBanner(
      `发现 Codeforces 提交 #${submission.submissionId}，但后台无法确认关联。请核对当前 CF 记录。`,
    );
    return true;
  }
  showFlowStatus(
    response.message ??
      `提交 #${submission.submissionId} 已识别，正在读取评测状态。`,
  );
  syncEvaluation(submission.submissionId, true);
  return true;
}

function isChallengePage(): boolean {
  return /just a moment|checking your browser|verify you are human|cloudflare/i.test(
    `${document.title} ${document.body?.innerText?.slice(0, 1200) ?? ""}`,
  );
}

function isSubmissionListPage(): boolean {
  return (
    location.pathname === "/problemset/status" ||
    /^\/contest\/\d+\/(?:status|my)\/?$/.test(location.pathname)
  );
}

function sanitizedResultReferrer(): string | undefined {
  if (!document.referrer) return undefined;
  try {
    const referrer = new URL(document.referrer);
    if (
      referrer.origin !== location.origin ||
      referrer.username ||
      referrer.password
    )
      return undefined;

    const route = parseCodeforcesSubmitUrl(referrer.href);
    if (route?.kind === "submit") {
      const safe = new URL(`${referrer.origin}${referrer.pathname}`);
      if (route.contestId && referrer.pathname === "/problemset/submit")
        safe.searchParams.set("contestId", route.contestId);
      if (route.index) safe.searchParams.set("problemIndex", route.index);
      return safe.href;
    }
    if (
      referrer.pathname === "/problemset/status" ||
      /^\/contest\/\d+\/(?:status|my)\/?$/.test(referrer.pathname)
    )
      return `${referrer.origin}${referrer.pathname}`;
  } catch {
    return undefined;
  }
  return undefined;
}

let claiming = false;
let submissionObserved = false;
let submissionWatchStarted = false;

function watchSubmissionResult(): void {
  if (submissionWatchStarted) return;
  submissionWatchStarted = true;
  const startedAt = Date.now();
  const finishUnknown = async (message: string): Promise<void> => {
    const response = await send({
      type: "UPDATE_CROSS_OJ_TASK",
      event: { kind: "result-unmatched" },
    });
    const resultUnknown =
      response?.ok === true && response.code === "result-unknown";
    const returnUrl = resultUnknown
      ? safeLuoguReturnUrl(response.returnUrl)
      : undefined;
    showBanner(
      resultUnknown
        ? message
        : `${message} OJTrace 无法完成自动关联，请核对当前 CF 提交记录。`,
      returnUrl ? { label: "手动返回洛谷题目页", href: returnUrl } : undefined,
    );
  };
  const check = async (): Promise<void> => {
    if (await inspectResult()) return;
    if (isSubmissionListPage()) {
      const lookup = await send({ type: "RESOLVE_CODEFORCES_SUBMISSION" });
      if (
        lookup?.code === "submission-candidate-matched" &&
        lookup.submissionDetailUrl &&
        isSubmissionListPage()
      ) {
        location.assign(lookup.submissionDetailUrl);
        return;
      }
      if (lookup?.code === "submission-candidate-ambiguous") {
        await finishUnknown(
          "Codeforces 出现多条可能的本次提交，OJTrace 没有猜测记录。请在当前提交列表核对。",
        );
        return;
      }
      if (lookup?.code === "submission-candidate-unavailable") {
        await finishUnknown(
          "OJTrace 无法建立 Codeforces 提交前基线，无法安全确认这条新记录。请在当前提交列表核对。",
        );
        return;
      }
      if (Date.now() - startedAt >= 30_000) {
        await finishUnknown(
          "Codeforces 已收到提交，但 OJTrace 未能唯一确认对应记录。请在当前提交列表核对。",
        );
        return;
      }
      window.setTimeout(() => void check(), 2_500);
      return;
    }
    if (Date.now() - startedAt >= 30_000) {
      await finishUnknown(
        "Codeforces 未在限定时间内显示可确认的提交详情。请检查 CF 提交记录。",
      );
      return;
    }
    window.setTimeout(() => void check(), 500);
  };
  window.setTimeout(() => void check(), 500);
}
async function claim(readinessAttempt = 0): Promise<void> {
  if (claiming) return;
  claiming = true;
  const response = await send({ type: "CLAIM_CROSS_OJ_TASK" });
  claiming = false;
  if (!response) {
    showBanner(
      "扩展后台没有确认提交状态。请检查 Codeforces 页面后再决定是否重试。",
    );
    return;
  }
  switch (response.code) {
    case "submission-triggered":
      showFlowStatus(
        `${profileLabel()}。已触发 Codeforces 原生表单，正在等待 CF 确认；请稍候，不要重复提交。`,
      );
      watchSubmissionResult();
      return;
    case "submission-attempted":
      showFlowStatus(
        `${profileLabel()}。已点击 Codeforces 原生提交控件，正在确认 CF 是否接收；请稍候，不要重复提交。`,
      );
      watchSubmissionResult();
      return;
    case "submission-in-progress":
      showFlowStatus(
        "已发起 Codeforces 提交，正在等待提交结果；请勿重复操作。",
      );
      watchSubmissionResult();
      return;
    case "submission-uncertain":
      showBanner(
        "无法确认 Codeforces 是否已接收本次提交。请先查看提交记录，确认没有重复后再从洛谷重新发起。",
      );
      return;
    case "submit-blocked-challenge-timeout":
      showBanner(
        "Codeforces 安全验证未在限定时间内完成，因此没有点击提交按钮。请完成页面上的验证后重新从洛谷发起。",
      );
      return;
    case "submit-blocked-submit-control-not-found":
      showBanner(
        "代码已填入，但没有找到唯一的 Codeforces 提交按钮，因此没有执行提交。请确认提交表单已完整加载。",
      );
      return;
    case "submit-blocked-submit-control-ambiguous":
      showBanner(
        "页面上找到多个可能的 Codeforces 提交按钮。为避免误点，OJTrace 没有提交；请检查表单。",
      );
      return;
    case "submit-blocked-submit-control-error":
      showBanner(
        "点击 Codeforces 提交按钮时发生错误，无法确认是否发起提交。请先检查 CF 提交记录，确认没有重复后再操作。",
      );
      return;
    case "submit-blocked-source-mismatch":
      showBanner(
        "Codeforces 在提交时改写了表单中的源代码字段，OJTrace 已取消这次提交，避免发送空代码或错误代码。请重新发起。",
      );
      return;
    case "filled":
      showBanner(
        "代码已填入，但 OJTrace 没有确认 Codeforces 接收提交。请先查看当前页面，不要重复发送。",
      );
      return;
    case "awaiting-user-submit":
      showBanner(
        `${profileLabel()}。请检查现有提交表单中的题号、语言和代码，再使用 Codeforces 原生提交按钮。`,
      );
      return;
    case "language-selection-required":
      showBanner(
        "未能唯一匹配洛谷语言，Codeforces 未提交。请在洛谷选择明确对应的语言后重新发起。",
      );
      return;
    case "existing-code":
      showBanner(
        "Codeforces 编辑器已有草稿。为避免覆盖或重复提交，OJTrace 未修改内容也未提交。",
      );
      return;
    case "login-required":
      showBanner(
        "请在当前标签页完成 Codeforces 登录，再返回提交页。任务将在 10 分钟后过期。",
      );
      return;
    case "security-check":
      showFlowStatus(
        "请按 Codeforces 页面提示完成安全验证，再返回提交页。OJTrace 不会绕过验证。",
      );
      return;
    case "unsupported-language":
      showBanner(
        "当前洛谷语言无法安全匹配 Codeforces 选项，代码未填入。请返回洛谷重新选择语言后发起。",
      );
      return;
    case "editor-unavailable":
      if (readinessAttempt < 10) {
        window.setTimeout(() => void claim(readinessAttempt + 1), 500);
        return;
      }
      showBanner(
        "Codeforces 编辑器未能加载，代码没有提交。请刷新后从洛谷重试。",
      );
      return;
    case "form-unavailable":
      if (readinessAttempt < 10) {
        window.setTimeout(() => void claim(readinessAttempt + 1), 500);
        return;
      }
      showBanner(
        "未找到 Codeforces 提交表单，代码没有提交。请检查登录或页面状态。",
      );
      return;
    case "task-not-found":
    case "task-already-claimed":
    case "unsupported-page":
    case "language-mismatch":
    case "invalid-transition":
      hideCrossOjSubmitMask();
      clearCrossOjFlowMarker();
      codeforcesCrossOjFlow = false;
      return;
    case "target-page-changed":
      showBanner("目标题目或页面已变化。请从洛谷重新发起。");
      return;
    default:
      if (response.ok) return;
      showBanner(response.message ?? "无法读取提交任务。请从洛谷重新发起。");
  }
}

function installSubmitObserver(): void {
  if (submissionObserved) return;
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (
        !(form instanceof HTMLFormElement) ||
        !form.matches("#submitForm, form[action*='/submit']")
      )
        return;
      submissionObserved = true;
      void send({
        type: "UPDATE_CROSS_OJ_TASK",
        event: { kind: "submit-observed", submitUrl: location.href },
      });
      watchSubmissionResult();
    },
    true,
  );
}

async function main(): Promise<void> {
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || !codeforcesCrossOjFlow) return;
    if (hasCrossOjFlowMarker()) return;
    codeforcesCrossOjFlow = false;
    hideCrossOjSubmitMask();
  });
  codeforcesCrossOjFlow = saveCrossOjFlowMarker();
  if (codeforcesCrossOjFlow)
    showCrossOjSubmitMask(
      "codeforces",
      "正在载入 Codeforces 原生提交与安全验证界面…",
    );
  await waitForDocumentReady();
  if (await inspectResult()) return;
  if (isSubmissionListPage()) {
    if (codeforcesCrossOjFlow) watchSubmissionResult();
    return;
  }
  const route = parseCodeforcesSubmitUrl(location.href);
  if (route?.kind === "submit") installSubmitObserver();
  if (route?.kind === "submit" || route?.kind === "login" || isChallengePage())
    await claim();
}

export default defineContentScript({
  matches: ["https://codeforces.com/*"],
  runAt: "document_start",
  main,
});
