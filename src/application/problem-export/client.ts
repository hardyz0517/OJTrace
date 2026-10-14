import {
  PROBLEM_EXPORT_SCHEMA_VERSION,
  isProblemExportResponse,
  type ProblemExportCommand,
  type ProblemExportMessage,
  type ProblemExportResponse,
} from "./messages";

export class ProblemExportClientError extends Error {
  constructor(
    readonly code:
      | "no_active_tab"
      | "missing_tab_url"
      | "transport"
      | "invalid_response"
      | "background_error"
      | "tab_changed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProblemExportClientError";
  }
}

export interface ActiveTabContext {
  tabId: number;
  url: string;
  title?: string;
}

export async function activeTabContext(): Promise<ActiveTabContext> {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  const tab = tabs.find((item) => typeof item.id === "number");
  if (!tab || tab.id === undefined)
    throw new ProblemExportClientError(
      "no_active_tab",
      "当前没有可用的活动标签页。",
    );
  if (!tab.url)
    throw new ProblemExportClientError(
      "missing_tab_url",
      "无法读取当前页面地址。",
    );
  return { tabId: tab.id, url: tab.url, title: tab.title };
}

function requestId(): string {
  return crypto.randomUUID();
}

async function send(
  command: ProblemExportCommand,
): Promise<Extract<ProblemExportResponse, { ok: true }>> {
  const message = {
    ...command,
    schemaVersion: PROBLEM_EXPORT_SCHEMA_VERSION,
    requestId: requestId(),
  } as ProblemExportMessage;
  let raw: unknown;
  try {
    raw = await browser.runtime.sendMessage(message);
  } catch (cause) {
    throw new ProblemExportClientError(
      "transport",
      "与后台通信失败，请重试。",
      { cause },
    );
  }
  if (!isProblemExportResponse(raw))
    throw new ProblemExportClientError(
      "invalid_response",
      "后台响应格式错误，请刷新后重试。",
    );
  if (!raw.ok)
    throw new ProblemExportClientError("background_error", raw.error.message);
  return raw;
}

export async function inspectActiveProblemPage() {
  const tab = await activeTabContext();
  const response = await send({
    type: "INSPECT_ACTIVE_PROBLEM_PAGE",
    tabId: tab.tabId,
    expectedUrl: tab.url,
  });
  if (response.type !== "PROBLEM_PREVIEW")
    throw new ProblemExportClientError(
      "invalid_response",
      "后台响应类型错误，请刷新后重试。",
    );
  return { tab, preview: response.preview };
}

export async function startProblemExport(expectedTab?: ActiveTabContext) {
  const tab = await activeTabContext();
  if (
    expectedTab &&
    (tab.tabId !== expectedTab.tabId || tab.url !== expectedTab.url)
  ) {
    throw new ProblemExportClientError(
      "tab_changed",
      "当前页面已发生变化，请重新识别题目后导出。",
    );
  }
  const response = await send({
    type: "START_PROBLEM_EXPORT",
    tabId: tab.tabId,
    expectedUrl: tab.url,
  });
  if (response.type !== "EXPORT_STARTED")
    throw new ProblemExportClientError(
      "invalid_response",
      "后台响应类型错误，请刷新后重试。",
    );
  return { tab, job: response.job };
}

export async function extractProblemMarkdown(expectedTab?: ActiveTabContext) {
  const tab = await activeTabContext();
  if (
    expectedTab &&
    (tab.tabId !== expectedTab.tabId || tab.url !== expectedTab.url)
  ) {
    throw new ProblemExportClientError(
      "tab_changed",
      "当前页面已发生变化，请重新识别题目后复制。",
    );
  }
  const response = await send({
    type: "EXTRACT_PROBLEM_MARKDOWN",
    tabId: tab.tabId,
    expectedUrl: tab.url,
  });
  if (response.type !== "PROBLEM_MARKDOWN")
    throw new ProblemExportClientError(
      "invalid_response",
      "后台响应类型错误，请刷新后重试。",
    );
  return { tab, markdown: response.markdown };
}

export async function openTimeline(): Promise<void> {
  const response = await send({ type: "OPEN_TIMELINE" });
  if (response.type !== "NAVIGATED")
    throw new ProblemExportClientError("invalid_response", "打开时间线失败。");
}

export async function openSettings(): Promise<void> {
  const response = await send({ type: "OPEN_SETTINGS" });
  if (response.type !== "NAVIGATED")
    throw new ProblemExportClientError("invalid_response", "打开设置失败。");
}
