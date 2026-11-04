import {
  CROSS_OJ_SCHEMA_VERSION,
  isCrossOjResponse,
  type CrossOjCommand,
  type CrossOjEvaluationStatus,
  type CrossOjResponse,
} from "../src/oj-enhancer/features/cross-oj-submit/model";
import {
  atcoderSubmissionFromUrl,
  parseAtCoderProblemUrl,
  parseAtCoderSubmitUrl,
} from "../src/oj-enhancer/features/cross-oj-submit/atcoder";
import {
  atcoderEvaluationFromPage,
  pollAndReportEvaluation,
} from "../src/oj-enhancer/features/cross-oj-submit/evaluation";

const BANNER_ID = "ojtrace-cross-oj-submit-banner";
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
function accountLabel(): string {
  const profile = document.querySelector<HTMLAnchorElement>(
    '#navbar-collapse a[href^="/users/"], header a[href^="/users/"]',
  );
  const account = profile?.pathname.split("/").filter(Boolean).at(-1);
  return account
    ? `当前 AtCoder 账号：${account}`
    : "请在 AtCoder 页面确认当前账号";
}
function showBanner(
  message: string,
  options?: Array<{ value: string; label: string }>,
  retry?: (value?: string) => void,
): void {
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
  account.textContent = accountLabel();
  account.style.fontWeight = "700";
  account.style.marginBottom = "6px";
  const text = document.createElement("div");
  text.textContent = message;
  banner.append(account, text);
  if (options?.length && retry) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "AtCoder 编程语言");
    for (const option of options) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      select.append(item);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "使用所选语言填入";
    button.addEventListener("click", () => retry(select.value), { once: true });
    banner.append(select, button);
  } else if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "重试填入";
    button.addEventListener("click", () => retry(), { once: true });
    banner.append(button);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "关闭提示";
  close.addEventListener("click", () => banner.remove());
  banner.append(close);
  document.documentElement.append(banner);
}
function taskInPage(): ReturnType<typeof parseAtCoderProblemUrl> {
  const tasks = new Map<
    string,
    NonNullable<ReturnType<typeof parseAtCoderProblemUrl>>
  >();
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/tasks/"]',
  )) {
    const problem = parseAtCoderProblemUrl(link.href);
    if (problem) tasks.set(problem.taskId, problem);
  }
  return tasks.size === 1 ? [...tasks.values()][0] : undefined;
}

function evaluationLabel(status: CrossOjEvaluationStatus): string {
  if (status === "accepted") return "评测结果：Accepted";
  if (status === "rejected") return "评测已结束，请在 AtCoder 查看具体结果";
  if (status === "unknown")
    return "已识别提交，评测状态暂时无法确认，请在 AtCoder 查看详情。";
  return "评测仍在进行；OJTrace 会在一分钟内有限检查页面状态";
}

function syncEvaluation(submissionId: string): void {
  const detailUrl = location.href;
  void pollAndReportEvaluation({
    isCurrentPage: () => location.href === detailUrl,
    readStatus: atcoderEvaluationFromPage,
    report: async (evaluationStatus) => {
      const response = await send({
        type: "UPDATE_CROSS_OJ_EVALUATION",
        submissionId,
        detailUrl,
        evaluationStatus,
      });
      return response?.ok === true && response.code === "evaluation-updated";
    },
    onReported: (status) => showBanner(evaluationLabel(status)),
  });
}

async function inspectResult(): Promise<boolean> {
  const submission = atcoderSubmissionFromUrl(location.href);
  if (!submission) return false;
  const referrer = parseAtCoderSubmitUrl(document.referrer);
  if (
    referrer?.kind !== "submit" ||
    referrer.contestId !== submission.contestId
  ) {
    const problem = taskInPage();
    if (problem) {
      const resumed = await send({
        type: "UPDATE_CROSS_OJ_TASK",
        event: {
          kind: "result-observed",
          oj: "atcoder",
          submissionId: submission.submissionId,
          detailUrl: location.href,
          contestId: problem.contestId,
          taskId: problem.taskId,
        },
      });
      if (resumed?.ok && resumed.code === "completed") {
        showBanner(
          `提交 #${submission.submissionId} 已识别，正在读取评测状态。`,
        );
        syncEvaluation(submission.submissionId);
        return true;
      }
    }
    syncEvaluation(submission.submissionId);
    return true;
  }
  await send({
    type: "UPDATE_CROSS_OJ_TASK",
    event: { kind: "submit-observed", submitUrl: document.referrer },
  });
  const problem = taskInPage();
  if (!problem) {
    const response = await send({
      type: "UPDATE_CROSS_OJ_TASK",
      event: { kind: "result-unmatched" },
    });
    if (response?.ok && response.code === "result-unknown")
      showBanner(
        `已观察到 AtCoder 提交 #${submission.submissionId}，但无法可靠确认题目归属。不会自动重试。`,
      );
    return true;
  }
  const response = await send({
    type: "UPDATE_CROSS_OJ_TASK",
    event: {
      kind: "result-observed",
      oj: "atcoder",
      submissionId: submission.submissionId,
      detailUrl: location.href,
      contestId: problem.contestId,
      taskId: problem.taskId,
    },
  });
  if (response?.ok && response.code === "completed")
    showBanner(
      response.message ??
        `提交 #${submission.submissionId} 已识别，正在读取评测状态。`,
    );
  if (response?.ok && response.code === "completed")
    syncEvaluation(submission.submissionId);
  return true;
}
let claiming = false;
let submissionObserved = false;
async function claim(targetLanguageValue?: string): Promise<void> {
  if (claiming) return;
  claiming = true;
  const response = await send({
    type: "CLAIM_CROSS_OJ_TASK",
    targetLanguageValue,
  });
  claiming = false;
  if (!response) return;
  switch (response.code) {
    case "filled":
      showBanner(
        `${accountLabel()}。代码和语言已填入；请核对题目、语言和代码，再使用 AtCoder 原生提交按钮。`,
      );
      return;
    case "awaiting-user-submit":
      showBanner(
        `${accountLabel()}。请检查题目、语言和代码，再使用 AtCoder 原生提交按钮。`,
      );
      return;
    case "language-selection-required":
      showBanner(
        "未能唯一匹配洛谷语言。请明确选择 AtCoder 语言后继续。",
        response.languageOptions,
        (value) => void claim(value),
      );
      return;
    case "existing-code":
      showBanner(
        "目标编辑器已有内容，OJTrace 保留了原内容。清空编辑器后可重试。",
        undefined,
        () => void claim(),
      );
      return;
    case "login-required":
      showBanner(
        "请在当前标签页完成 AtCoder 登录，再返回提交页。任务将在 10 分钟后过期。",
      );
      return;
    case "security-check":
      showBanner(
        "请按 AtCoder 页面提示完成安全验证，再返回提交页。OJTrace 不会绕过验证。",
      );
      return;
    case "unsupported-language":
      showBanner("当前洛谷语言无法安全匹配 AtCoder 选项，代码未填入。");
      return;
    case "editor-unavailable":
      showBanner(
        "AtCoder 编辑器尚未就绪，代码未填入。页面加载后可重试。",
        undefined,
        () => void claim(),
      );
      return;
    case "form-unavailable":
      showBanner(
        "未找到 AtCoder 提交表单，请等待页面加载后重试。",
        undefined,
        () => void claim(),
      );
      return;
    case "task-not-found":
    case "task-already-claimed":
    case "unsupported-page":
    case "language-mismatch":
    case "invalid-transition":
      return;
    case "target-page-changed":
      showBanner("目标题目或页面已变化，请从洛谷重新发起。");
      return;
    default:
      if (!response.ok)
        showBanner(
          response.message ?? "无法读取跨 OJ 任务，请从洛谷重新发起。",
        );
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
        !form.matches("form.form-code-submit")
      )
        return;
      submissionObserved = true;
      void send({
        type: "UPDATE_CROSS_OJ_TASK",
        event: { kind: "submit-observed", submitUrl: location.href },
      });
      const startedAt = Date.now();
      const check = async (): Promise<void> => {
        if (await inspectResult()) return;
        if (Date.now() - startedAt >= 15_000) {
          const response = await send({
            type: "UPDATE_CROSS_OJ_TASK",
            event: { kind: "result-unmatched" },
          });
          if (response?.ok && response.code === "result-unknown")
            showBanner(
              "已观察到提交操作，但无法可靠关联本次提交结果。不会自动重试。",
            );
          return;
        }
        window.setTimeout(() => void check(), 500);
      };
      window.setTimeout(() => void check(), 500);
    },
    true,
  );
}
async function main(): Promise<void> {
  if (await inspectResult()) return;
  const route = parseAtCoderSubmitUrl(location.href);
  if (route?.kind === "submit") installSubmitObserver();
  if (
    route?.kind === "submit" ||
    route?.kind === "login" ||
    /challenge|captcha/i.test(location.href)
  )
    await claim();
}

export default defineContentScript({
  matches: ["https://atcoder.jp/*"],
  runAt: "document_idle",
  main,
});
