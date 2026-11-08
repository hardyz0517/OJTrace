import {
  CROSS_OJ_SCHEMA_VERSION,
  isCrossOjResponse,
  type CrossOjCommand,
  type CrossOjEvaluationStatus,
  type CrossOjResponse,
} from "../src/oj-enhancer/features/cross-oj-submit/model";
import {
  atcoderSubmissionTimestamp,
  atcoderSubmissionFromUrl,
  isAtCoderSubmissionIdCorrelated,
  isAtCoderSubmissionTimeCorrelated,
  parseAtCoderProblemUrl,
  parseAtCoderSubmitUrl,
} from "../src/oj-enhancer/features/cross-oj-submit/atcoder";
import {
  atcoderEvaluationFromPage,
  pollAndReportEvaluation,
} from "../src/oj-enhancer/features/cross-oj-submit/evaluation";
import {
  buildLuoguCrossOjRecordUrl,
  parseAtCoderSubmissionDetail,
  safeLuoguReturnUrl,
} from "../src/oj-enhancer/features/cross-oj-submit/record-details";
import {
  hideAtCoderSubmitMask,
  showAtCoderSubmitMask,
} from "../src/oj-enhancer/features/cross-oj-submit/submit-mask";

const BANNER_ID = "ojtrace-cross-oj-submit-banner";
const EXPECTED_PROBLEM_KEY = "ojtrace:atcoder:expected-problem";
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

function rememberExpectedProblem(problem: unknown): void {
  if (!problem || typeof problem !== "object") return;
  try {
    const candidate = problem as {
      oj?: unknown;
      contestId?: unknown;
      taskId?: unknown;
    };
    if (
      candidate.oj !== "atcoder" ||
      typeof candidate.contestId !== "string" ||
      typeof candidate.taskId !== "string"
    )
      return;
    const previous = expectedProblem();
    const startedAt =
      previous?.contestId === candidate.contestId &&
      previous.taskId === candidate.taskId
        ? previous.startedAt
        : Date.now();
    const baselineSubmissionId =
      previous?.contestId === candidate.contestId &&
      previous.taskId === candidate.taskId
        ? previous.baselineSubmissionId
        : undefined;
    sessionStorage.setItem(
      EXPECTED_PROBLEM_KEY,
      JSON.stringify({ ...candidate, startedAt, baselineSubmissionId }),
    );
  } catch {
    // Session storage may be disabled; DOM correlation remains available.
  }
}

function expectedProblem():
  | {
      oj: "atcoder";
      contestId: string;
      taskId: string;
      startedAt: number;
      baselineSubmissionId?: string;
    }
  | undefined {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(EXPECTED_PROBLEM_KEY) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      (value as { oj?: unknown }).oj === "atcoder" &&
      typeof (value as { contestId?: unknown }).contestId === "string" &&
      typeof (value as { taskId?: unknown }).taskId === "string" &&
      typeof (value as { startedAt?: unknown }).startedAt === "number" &&
      Date.now() - Number((value as { startedAt: number }).startedAt) <
        10 * 60_000 &&
      Number((value as { startedAt: number }).startedAt) <= Date.now() + 30_000
    )
      return value as {
        oj: "atcoder";
        contestId: string;
        taskId: string;
        startedAt: number;
        baselineSubmissionId?: string;
      };
  } catch {
    // Ignore malformed stale markers.
  }
  return undefined;
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

async function waitForAtCoderDocument(
  route: ReturnType<typeof parseAtCoderSubmitUrl>,
): Promise<void> {
  const submission = atcoderSubmissionFromUrl(location.href);
  const selectors =
    route?.kind === "submit"
      ? "form.form-code-submit, form[action*='/login'], .cf-challenge, .cf-turnstile, iframe[src*='challenges.cloudflare.com']"
      : route?.kind === "submission-list"
        ? "table"
        : route?.kind === "login"
          ? "form[action*='/login']"
          : submission
            ? "table"
            : /challenge|captcha/i.test(location.href)
              ? ".cf-challenge, .cf-turnstile, iframe[src*='challenges.cloudflare.com']"
              : undefined;
  if (!selectors) return;
  if (document.readyState !== "loading" && document.querySelector(selectors))
    return;
  await new Promise<void>((resolve) => {
    let settled = false;
    let timeout: number | undefined;
    let domTimeout: number | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      document.removeEventListener("DOMContentLoaded", onDomContentLoaded);
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (domTimeout !== undefined) window.clearTimeout(domTimeout);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector(selectors)) finish();
    });
    const onDomContentLoaded = (): void => {
      if (document.querySelector(selectors)) finish();
      else domTimeout = window.setTimeout(finish, 3_000);
    };
    const root = document.documentElement;
    if (root) {
      observer.observe(root, { childList: true, subtree: true });
    }
    document.addEventListener("DOMContentLoaded", onDomContentLoaded, {
      once: true,
    });
    // Keep the early document_start mask alive until the target form/challenge
    // exists or the bounded timeout expires; DOMContentLoaded alone does not
    // guarantee that AtCoder's editor has been mounted.
    timeout = window.setTimeout(finish, 8_000);
    if (document.querySelector(selectors)) finish();
  });
}

function hasAtCoderCrossOjMarker(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.origin === "https://atcoder.jp" &&
      url.searchParams.get("ojtrace") === "1"
    );
  } catch {
    return false;
  }
}

function isAtCoderCrossOjFlow(
  expected: ReturnType<typeof expectedProblem>,
): boolean {
  return (
    hasAtCoderCrossOjMarker(location.href) ||
    hasAtCoderCrossOjMarker(document.referrer) ||
    expected?.oj === "atcoder"
  );
}

function submissionDetailForTask(
  contestId: string,
  taskId: string,
  startedAt: number,
  baselineSubmissionId?: string,
): string | undefined {
  const expectedTask = taskId.toLowerCase();
  for (const row of document.querySelectorAll("tr")) {
    const taskLink = Array.from(
      row.querySelectorAll<HTMLAnchorElement>('a[href*="/tasks/"]'),
    ).find(
      (link) => parseAtCoderProblemUrl(link.href)?.taskId === expectedTask,
    );
    if (!taskLink) continue;
    const detail = Array.from(
      row.querySelectorAll<HTMLAnchorElement>('a[href*="/submissions/"]'),
    ).find(
      (link) => atcoderSubmissionFromUrl(link.href)?.contestId === contestId,
    );
    if (!detail) continue;
    const submittedTime = row.querySelector("time");
    const submittedAt = atcoderSubmissionTimestamp({
      datetime: submittedTime?.getAttribute("datetime"),
      unixSeconds: submittedTime?.getAttribute("data-seconds"),
      text: submittedTime?.textContent,
    });
    const submissionId = atcoderSubmissionFromUrl(detail.href)?.submissionId;
    const timeCorrelated =
      submittedAt !== undefined &&
      isAtCoderSubmissionTimeCorrelated({ submittedAt, startedAt });
    const idCorrelated =
      submissionId !== undefined &&
      baselineSubmissionId !== undefined &&
      isAtCoderSubmissionIdCorrelated({ submissionId, baselineSubmissionId });
    if (
      baselineSubmissionId !== undefined
        ? idCorrelated && (submittedAt === undefined || timeCorrelated)
        : timeCorrelated
    )
      return detail.href;
  }
  return undefined;
}

async function inspectSubmissionList(): Promise<boolean> {
  const route = parseAtCoderSubmitUrl(location.href);
  if (route?.kind !== "submission-list") return false;
  const expected = expectedProblem();
  if (!expected || expected.contestId !== route.contestId) return false;
  showAtCoderSubmitMask("正在确认 AtCoder 是否已收到本次提交…");
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const detail = submissionDetailForTask(
      route.contestId,
      expected.taskId,
      expected.startedAt,
      expected.baselineSubmissionId,
    );
    if (detail) {
      location.assign(detail);
      return true;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
  }
  const response = await send({
    type: "UPDATE_CROSS_OJ_TASK",
    event: { kind: "result-unmatched" },
  });
  if (response?.ok && response.code === "result-unknown") {
    sessionStorage.removeItem(EXPECTED_PROBLEM_KEY);
    showAtCoderSubmitMask(
      "AtCoder 已收到提交，但暂时无法确认对应记录；正在返回洛谷。",
    );
    const destination = safeLuoguReturnUrl(response.returnUrl);
    if (destination)
      window.setTimeout(() => location.assign(destination), 3_000);
  }
  return true;
}

function evaluationLabel(status: CrossOjEvaluationStatus): string {
  if (status === "accepted") return "评测结果：Accepted";
  if (status === "rejected") return "评测已结束，请在 AtCoder 查看具体结果";
  if (status === "unknown")
    return "已识别提交，评测状态暂时无法确认，请在 AtCoder 查看详情。";
  return "评测仍在进行；OJTrace 会在一分钟内有限检查页面状态";
}

async function syncEvaluation(
  submissionId: string,
  returnUrl?: string,
): Promise<void> {
  const detailUrl = location.href;
  const submission = atcoderSubmissionFromUrl(detailUrl);
  const detail = parseAtCoderSubmissionDetail(document, detailUrl);
  if (detail) {
    await send({
      type: "SAVE_CROSS_OJ_DETAIL",
      detail,
    });
  }
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
    onReported: (status) => showAtCoderSubmitMask(evaluationLabel(status)),
  });
  const destination = safeLuoguReturnUrl(returnUrl);
  const recordPage =
    destination && submission
      ? (() => {
          const problemId =
            detail?.problemId ??
            (expectedProblem()?.taskId
              ? `${submission.contestId}_${expectedProblem()!.taskId}`
              : undefined);
          return problemId
            ? buildLuoguCrossOjRecordUrl(
                "atcoder",
                submission.contestId,
                submissionId,
                problemId,
                destination,
              )
            : undefined;
        })()
      : undefined;
  if (recordPage)
    window.setTimeout(() => {
      if (location.href !== detailUrl) return;
      location.assign(recordPage);
    }, 2_500);
}

async function inspectResult(): Promise<boolean> {
  const submission = atcoderSubmissionFromUrl(location.href);
  if (!submission) return false;
  const expected = expectedProblem();
  const displayedProblem = taskInPage();
  if (
    expected &&
    expected.contestId === submission.contestId &&
    displayedProblem?.contestId === expected.contestId &&
    displayedProblem.taskId === expected.taskId
  ) {
    showAtCoderSubmitMask(
      `已找到本次 AtCoder 提交 #${submission.submissionId}，正在读取结果…`,
    );
    const submitUrl = `https://atcoder.jp/contests/${encodeURIComponent(expected.contestId)}/submit`;
    await send({
      type: "UPDATE_CROSS_OJ_TASK",
      event: { kind: "submit-observed", submitUrl },
    });
    const response = await send({
      type: "UPDATE_CROSS_OJ_TASK",
      event: {
        kind: "result-observed",
        oj: "atcoder",
        submissionId: submission.submissionId,
        detailUrl: location.href,
        contestId: expected.contestId,
        taskId: expected.taskId,
      },
    });
    if (response?.ok && response.code === "completed") {
      sessionStorage.removeItem(EXPECTED_PROBLEM_KEY);
      showAtCoderSubmitMask(
        response.message ??
          `提交 #${submission.submissionId} 已识别，正在读取评测状态。`,
      );
      syncEvaluation(submission.submissionId, response.returnUrl);
      return true;
    }
    hideAtCoderSubmitMask();
  }
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
        showAtCoderSubmitMask(
          `提交 #${submission.submissionId} 已识别，正在读取评测状态。`,
        );
        syncEvaluation(submission.submissionId, resumed.returnUrl);
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
      showAtCoderSubmitMask(
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
    showAtCoderSubmitMask(
      response.message ??
        `提交 #${submission.submissionId} 已识别，正在读取评测状态。`,
    );
  if (response?.ok && response.code === "completed") {
    sessionStorage.removeItem(EXPECTED_PROBLEM_KEY);
    syncEvaluation(submission.submissionId, response.returnUrl);
  }
  return true;
}
let claiming = false;
let submissionObserved = false;
async function claim(targetLanguageValue?: string): Promise<void> {
  if (claiming) return;
  claiming = true;
  showAtCoderSubmitMask("正在校验题目、语言和代码，并准备 AtCoder 原生提交…");
  let response: CrossOjResponse | undefined;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    response = await send({
      type: "CLAIM_CROSS_OJ_TASK",
      targetLanguageValue,
    });
    if (
      !response ||
      (response.code !== "editor-unavailable" &&
        response.code !== "form-unavailable") ||
      attempt === 11
    )
      break;
    showAtCoderSubmitMask("AtCoder 正在初始化提交表单和代码编辑器…");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
  }
  claiming = false;
  if (!response) {
    hideAtCoderSubmitMask();
    document.getElementById(BANNER_ID)?.remove();
    return;
  }
  switch (response.code) {
    case "filled":
      hideAtCoderSubmitMask();
      showBanner(
        `${accountLabel()}。代码和语言已填入；请核对题目、语言和代码，再使用 AtCoder 原生提交按钮。`,
      );
      return;
    case "submission-triggered":
    case "submission-attempted":
      rememberExpectedProblem(response.problem);
      showAtCoderSubmitMask("AtCoder 原生提交已触发，正在等待提交详情…");
      return;
    case "submission-in-progress":
      rememberExpectedProblem(response.problem);
      showAtCoderSubmitMask("AtCoder 提交已发出，正在等待提交详情…");
      return;
    case "awaiting-user-submit":
      hideAtCoderSubmitMask();
      showBanner(
        `${accountLabel()}。请检查题目、语言和代码，再使用 AtCoder 原生提交按钮。`,
      );
      return;
    case "language-selection-required":
      hideAtCoderSubmitMask();
      showBanner(
        "未能唯一确定目标语言。请明确选择 AtCoder 语言后继续。",
        response.languageOptions,
        (value) => void claim(value),
      );
      return;
    case "existing-code":
      hideAtCoderSubmitMask();
      showBanner(
        "目标编辑器已有内容，OJTrace 保留了原内容。清空编辑器后可重试。",
        undefined,
        () => void claim(),
      );
      return;
    case "login-required":
      hideAtCoderSubmitMask();
      showBanner(
        "请在当前标签页完成 AtCoder 登录，再返回提交页。任务将在 10 分钟后过期。",
      );
      return;
    case "security-check":
      showAtCoderSubmitMask(
        "请在此页面完成 AtCoder 安全验证，验证完成后将继续提交。",
      );
      return;
    case "unsupported-language":
      hideAtCoderSubmitMask();
      showBanner("AtCoder 当前语言列表中没有找到 C++23，代码未填入。");
      return;
    case "editor-unavailable":
      hideAtCoderSubmitMask();
      showBanner(
        "AtCoder 编辑器尚未就绪，代码未填入。页面加载后可重试。",
        undefined,
        () => void claim(),
      );
      return;
    case "form-unavailable":
      hideAtCoderSubmitMask();
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
      hideAtCoderSubmitMask();
      document.getElementById(BANNER_ID)?.remove();
      return;
    case "target-page-changed":
      hideAtCoderSubmitMask();
      showBanner("目标题目或页面已变化，请从洛谷重新发起。");
      return;
    default:
      if (!response.ok) {
        hideAtCoderSubmitMask();
        showBanner(
          response.message ?? "无法读取跨 OJ 任务，请从洛谷重新发起。",
        );
      }
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
            showAtCoderSubmitMask(
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
  const route = parseAtCoderSubmitUrl(location.href);
  const expected = expectedProblem();
  const crossOjFlow = isAtCoderCrossOjFlow(expected);
  if (crossOjFlow) {
    if (route?.kind === "submit")
      showAtCoderSubmitMask("正在打开 AtCoder 原生提交表单…");
    else if (
      route?.kind === "submission-list" &&
      expected?.contestId === route.contestId
    )
      showAtCoderSubmitMask("正在确认 AtCoder 是否已收到本次提交…");
    else if (/challenge|captcha/i.test(location.href))
      showAtCoderSubmitMask("请在 AtCoder 安全验证框中完成验证…");
    await waitForAtCoderDocument(route);
  } else if (atcoderSubmissionFromUrl(location.href))
    await waitForAtCoderDocument(route);
  if (await inspectResult()) return;
  if (await inspectSubmissionList()) return;
  if (crossOjFlow && route?.kind === "submit") installSubmitObserver();
  if (
    crossOjFlow &&
    (route?.kind === "submit" ||
      route?.kind === "login" ||
      /challenge|captcha/i.test(location.href))
  )
    await claim();
}

export default defineContentScript({
  matches: ["https://atcoder.jp/*"],
  runAt: "document_start",
  main,
});
