import {
  crossOjResponse,
  isCrossOjMessage,
  type CrossOjMessage,
  type CrossOjResponse,
} from "./model";
import {
  fillCodeforcesFormInPage,
  inspectCodeforcesFormInPage,
} from "./codeforces-page";
import {
  fillAtCoderFormInPage,
  inspectAtCoderFormInPage,
} from "./atcoder-page";
import { CrossOjSubmitService, CROSS_OJ_TASK_PREFIX } from "./service";
import type { CrossOjProblemRef, CrossOjSubmitTask } from "./model";
import { readLuoguEditorInPage } from "./luogu-editor";
import { readLuoguPageProblemContextInPage } from "./luogu-page-context";
import {
  resolveLuoguProblem,
  sameLuoguPageDocumentUrl,
  sameLuoguProblem,
} from "./luogu-problem";

const LUOGU_PERMISSION = "https://www.luogu.com.cn/*";
const CODEFORCES_PERMISSION = "https://codeforces.com/*";
const ATCODER_PERMISSION = "https://atcoder.jp/*";
const CROSS_OJ_EXPIRY_ALARM_PREFIX = "ojtrace:cross-oj-submit:expire:";
const CROSS_OJ_HISTORY_KEY = "ojtrace:cross-oj-submit:history";
const LUOGU_CONTENT_SCRIPT_ID = "ojtrace-luogu-cross-oj";
const LUOGU_CONTENT_SCRIPT_FILE = "content-scripts/luogu-cross-oj.js";
const LUOGU_CONTENT_SCRIPT_PUBLIC_PATH =
  "content-scripts/luogu-cross-oj.js" as unknown as `/content-scripts/luogu-cross-oj.js`;

export async function clearCrossOjHistory(): Promise<void> {
  await service.clearHistory();
}

const service = new CrossOjSubmitService({
  storage: {
    async get(key) {
      const stored = await browser.storage.session.get(key);
      const task = stored[key];
      return task && typeof task === "object"
        ? (task as CrossOjSubmitTask)
        : undefined;
    },
    async set(key, task) {
      await browser.storage.session.set({ [key]: task });
    },
    async remove(key) {
      await browser.storage.session.remove(key);
    },
    async getAll() {
      return browser.storage.session.get(null);
    },
  },
  tabs: {
    async get(tabId) {
      const tab = await browser.tabs.get(tabId);
      return { id: tab.id, url: tab.url };
    },
    async create(properties) {
      const tab = await browser.tabs.create(properties);
      return { id: tab.id };
    },
    async update(tabId, properties) {
      return browser.tabs.update(tabId, properties);
    },
    async remove(tabId) {
      await browser.tabs.remove(tabId);
    },
  },
  adapter: {
    async inspect(task) {
      const result =
        task.problem.oj === "codeforces"
          ? await browser.scripting.executeScript({
              target: { tabId: task.targetTabId },
              world: "MAIN",
              func: inspectCodeforcesFormInPage,
            })
          : await browser.scripting.executeScript({
              target: { tabId: task.targetTabId },
              world: "MAIN",
              func: inspectAtCoderFormInPage,
              args: [{ problem: task.problem }],
            });
      const inspection = result[0]?.result;
      return inspection?.status === "ready"
        ? { ...inspection, documentId: result[0]?.documentId }
        : (inspection ?? { status: "form-unavailable" as const });
    },
    async fill(task, languageValue, documentId) {
      const target = documentId
        ? { tabId: task.targetTabId, documentIds: [documentId] }
        : { tabId: task.targetTabId };
      const result =
        task.problem.oj === "codeforces"
          ? await browser.scripting.executeScript({
              target,
              world: "MAIN",
              func: fillCodeforcesFormInPage,
              args: [
                {
                  problem: task.problem,
                  code: task.editor?.code ?? "",
                  languageValue,
                  submit: true,
                },
              ],
            })
          : await browser.scripting.executeScript({
              target,
              world: "MAIN",
              func: fillAtCoderFormInPage,
              args: [
                {
                  problem: task.problem,
                  code: task.editor?.code ?? "",
                  languageValue,
                },
              ],
            });
      return (
        result[0]?.result ??
        (task.problem.oj === "codeforces"
          ? { status: "submit-uncertain" as const }
          : { status: "changed" as const })
      );
    },
  },
  history: {
    async get() {
      return (await browser.storage.local.get(CROSS_OJ_HISTORY_KEY))[
        CROSS_OJ_HISTORY_KEY
      ];
    },
    async set(records) {
      await browser.storage.local.set({ [CROSS_OJ_HISTORY_KEY]: records });
    },
  },
  hasPermissions: (problem) =>
    browser.permissions.contains({
      origins: [
        LUOGU_PERMISSION,
        problem.oj === "codeforces"
          ? CODEFORCES_PERMISSION
          : ATCODER_PERMISSION,
      ],
    }),
  async scheduleExpiration(tabId, expiresAt) {
    await browser.alarms.create(`${CROSS_OJ_EXPIRY_ALARM_PREFIX}${tabId}`, {
      when: expiresAt,
    });
  },
  async clearExpiration(tabId) {
    await browser.alarms.clear(`${CROSS_OJ_EXPIRY_ALARM_PREFIX}${tabId}`);
  },
});

export function isCrossOjTaskKey(key: string): boolean {
  return key.startsWith(CROSS_OJ_TASK_PREFIX);
}

export function registerCrossOjSubmitBackground(): void {
  void ensureLuoguPageIntegration();
  void service.cleanupExpired().then(() => service.rearmExpirations());
  browser.alarms?.onAlarm?.addListener((alarm) => {
    if (!alarm.name.startsWith(CROSS_OJ_EXPIRY_ALARM_PREFIX)) return;
    const tabId = Number(alarm.name.slice(CROSS_OJ_EXPIRY_ALARM_PREFIX.length));
    if (Number.isInteger(tabId) && tabId >= 0) void service.expire(tabId);
  });
  browser.tabs?.onRemoved?.addListener((tabId) => {
    void service.onTabRemoved(tabId);
  });
  browser.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
    if (
      changeInfo.status === "complete" &&
      tab.url?.startsWith("https://www.luogu.com.cn/")
    )
      void ensureLuoguPageIntegration(tabId);
    if (changeInfo.url) void service.onTabUrlUpdated(tabId, changeInfo.url);
  });
}

async function ensureLuoguPageIntegration(targetTabId?: number): Promise<void> {
  if (!browser.permissions?.contains) return;
  let granted = false;
  try {
    const [luoguGranted, codeforcesGranted, atcoderGranted] = await Promise.all(
      [
        browser.permissions.contains({ origins: [LUOGU_PERMISSION] }),
        browser.permissions.contains({ origins: [CODEFORCES_PERMISSION] }),
        browser.permissions.contains({ origins: [ATCODER_PERMISSION] }),
      ],
    );
    granted = luoguGranted && (codeforcesGranted || atcoderGranted);
  } catch {
    return;
  }
  if (!granted) return;
  try {
    const registered = await browser.scripting.getRegisteredContentScripts();
    if (!registered.some((script) => script.id === LUOGU_CONTENT_SCRIPT_ID)) {
      await browser.scripting.registerContentScripts([
        {
          id: LUOGU_CONTENT_SCRIPT_ID,
          matches: ["https://www.luogu.com.cn/*"],
          js: [LUOGU_CONTENT_SCRIPT_FILE],
          runAt: "document_idle",
          persistAcrossSessions: true,
        },
      ]);
    }
    const tabs =
      typeof targetTabId === "number"
        ? [{ id: targetTabId }]
        : await browser.tabs.query({});
    await Promise.all(
      tabs.map(async (candidate) => {
        if (typeof candidate.id !== "number") return;
        try {
          const tab = await browser.tabs.get(candidate.id);
          if (
            !tab.url ||
            new URL(tab.url).origin !== "https://www.luogu.com.cn"
          )
            return;
          await browser.scripting.executeScript({
            target: { tabId: candidate.id },
            files: [LUOGU_CONTENT_SCRIPT_PUBLIC_PATH],
          });
        } catch {
          // A later completed navigation retries transient injection failures.
        }
      }),
    );
  } catch {
    // The page integration is optional; the popup and target adapters remain usable.
  }
}

function isLuoguPageSender(sender: {
  url?: string;
  frameId?: number;
  tab?: { id?: number };
}): sender is { url: string; frameId: number; tab: { id: number } } {
  if (
    sender.frameId !== 0 ||
    typeof sender.tab?.id !== "number" ||
    typeof sender.url !== "string"
  )
    return false;
  try {
    return new URL(sender.url).origin === "https://www.luogu.com.cn";
  } catch {
    return false;
  }
}

async function resolveLuoguProblemInTab(
  tabId: number,
  expectedUrl: string,
): Promise<CrossOjProblemRef | undefined> {
  const tab = await browser.tabs.get(tabId);
  if (!tab.url || !sameLuoguPageDocumentUrl(tab.url, expectedUrl))
    return undefined;
  const result = await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: readLuoguPageProblemContextInPage,
  });
  const context = result[0]?.result;
  return resolveLuoguProblem(tab.url, context)?.problem;
}

export async function handleCrossOjSubmitMessage(
  raw: unknown,
  sender: {
    id?: string;
    url?: string;
    frameId?: number;
    tab?: { id?: number };
  },
): Promise<CrossOjResponse | undefined> {
  if (!isCrossOjMessage(raw)) return undefined;
  const message: CrossOjMessage = raw;
  if (sender.id !== browser.runtime.id)
    return crossOjResponse(message.requestId, false, "unauthorized-sender");
  try {
    if (message.type === "CAPTURE_CROSS_OJ_EDITOR") {
      if (!isLuoguPageSender(sender))
        return crossOjResponse(message.requestId, false, "unauthorized-sender");
      const sourceTab = await browser.tabs.get(sender.tab.id);
      if (
        !sourceTab.url ||
        !sameLuoguPageDocumentUrl(sourceTab.url, sender.url)
      )
        return crossOjResponse(message.requestId, false, "tab-changed");
      const result = await browser.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: "MAIN",
        func: readLuoguEditorInPage,
      });
      const captured = result[0]?.result;
      if (!captured || typeof captured !== "object" || !captured.ok) {
        const code = captured?.reason ?? "editor-unavailable";
        return crossOjResponse(message.requestId, false, code, {
          message:
            code === "empty-code"
              ? "洛谷编辑器中的代码为空。"
              : code === "language-unavailable"
                ? "无法唯一确认洛谷当前语言，请确认语言选择器已加载。"
                : "无法定位洛谷当前代码编辑器。请确认正在“提交代码”页，再刷新页面后重试。",
        });
      }
      if (
        typeof captured.code !== "string" ||
        !captured.code.trim() ||
        captured.code.length > 256_000 ||
        typeof captured.language !== "string" ||
        !captured.language.trim() ||
        captured.language.length > 120 ||
        typeof captured.editorKind !== "string" ||
        captured.editorKind.length > 80
      )
        return crossOjResponse(message.requestId, false, "invalid-editor");
      return crossOjResponse(message.requestId, true, "editor-captured", {
        editor: {
          code: captured.code,
          luoguLanguage: captured.language,
          editorKind: captured.editorKind,
          capturedAt: Date.now(),
        },
      });
    }
    if (message.type === "CHECK_CROSS_OJ_PAGE_ACCESS") {
      if (!isLuoguPageSender(sender))
        return crossOjResponse(message.requestId, false, "unauthorized-sender");
      const sourceTab = await browser.tabs.get(sender.tab.id);
      if (
        !sourceTab.url ||
        !sameLuoguPageDocumentUrl(sourceTab.url, sender.url)
      )
        return crossOjResponse(message.requestId, false, "page-url-changed");
      const parsed = await resolveLuoguProblemInTab(sender.tab.id, sender.url);
      if (!sameLuoguProblem(parsed, message.problem))
        return crossOjResponse(message.requestId, false, "problem-mismatch");
      const targetPermission =
        message.problem.oj === "codeforces"
          ? CODEFORCES_PERMISSION
          : ATCODER_PERMISSION;
      const allowed = await browser.permissions.contains({
        origins: [LUOGU_PERMISSION, targetPermission],
      });
      return crossOjResponse(
        message.requestId,
        true,
        allowed ? "page-access-allowed" : "page-access-required",
      );
    }
    if (message.type === "CREATE_CROSS_OJ_TASK") {
      const extensionBase = browser.runtime.getURL("/");
      const fromExtension = sender.url?.startsWith(extensionBase) ?? false;
      const fromLuogu = isLuoguPageSender(sender);
      if (!fromExtension && !fromLuogu)
        return crossOjResponse(message.requestId, false, "unauthorized-sender");
      const sourceTabId = fromLuogu ? sender.tab.id : message.sourceTabId;
      const sourceUrl = fromLuogu ? sender.url : message.sourceUrl;
      if (typeof sourceTabId !== "number" || typeof sourceUrl !== "string")
        return crossOjResponse(message.requestId, false, "invalid-source");
      const sourceProblem = await resolveLuoguProblemInTab(
        sourceTabId,
        sourceUrl,
      );
      if (!sameLuoguProblem(sourceProblem, message.problem))
        return crossOjResponse(message.requestId, false, "problem-mismatch");
      const created = await service.create({
        sourceTabId,
        sourceUrl,
        problem: message.problem,
        editor: message.editor,
      });
      return crossOjResponse(message.requestId, true, "opened", {
        targetTabId: created.targetTabId,
        targetUrl: created.targetUrl,
      });
    }
    if (message.type === "GET_CROSS_OJ_HISTORY") {
      const extensionBase = browser.runtime.getURL("/");
      if (!sender.url?.startsWith(extensionBase))
        return crossOjResponse(message.requestId, false, "unauthorized-sender");
      return crossOjResponse(message.requestId, true, "history-loaded", {
        history: await service.getHistory(),
      });
    }
    if (
      !sender.tab ||
      typeof sender.tab.id !== "number" ||
      sender.frameId !== 0 ||
      !sender.url
    )
      return crossOjResponse(message.requestId, false, "unauthorized-sender");
    const pageUrl = new URL(sender.url);
    if (
      pageUrl.origin !== "https://codeforces.com" &&
      pageUrl.origin !== "https://atcoder.jp"
    )
      return crossOjResponse(message.requestId, false, "unauthorized-sender");

    switch (message.type) {
      case "CLAIM_CROSS_OJ_TASK": {
        const outcome = await service.claim(
          sender.tab.id,
          message.targetLanguageValue,
        );
        return crossOjResponse(message.requestId, outcome.ok, outcome.code, {
          message: outcome.message,
          languageOptions: outcome.languageOptions,
          taskState: outcome.taskState,
          returnUrl: outcome.returnUrl,
        });
      }
      case "UPDATE_CROSS_OJ_TASK": {
        const event =
          message.event.kind === "result-observed" && "index" in message.event
            ? {
                kind: "result-observed" as const,
                submissionId: message.event.submissionId,
                detailUrl: message.event.detailUrl,
                contestId: message.event.contestId,
                index: message.event.index,
              }
            : message.event;
        const outcome = await service.update(sender.tab.id, sender.url, event);
        return crossOjResponse(message.requestId, outcome.ok, outcome.code, {
          taskState: outcome.taskState,
          result: outcome.result,
          returnUrl: outcome.returnUrl,
          message: outcome.message,
        });
      }
      case "UPDATE_CROSS_OJ_EVALUATION": {
        const currentTab = await browser.tabs.get(sender.tab.id);
        if (currentTab.url !== sender.url)
          return crossOjResponse(
            message.requestId,
            false,
            "target-page-changed",
          );
        const outcome = await service.updateEvaluation({
          currentUrl: sender.url,
          detailUrl: message.detailUrl,
          submissionId: message.submissionId,
          evaluationStatus: message.evaluationStatus,
        });
        return crossOjResponse(message.requestId, outcome.ok, outcome.code);
      }
      case "CANCEL_CROSS_OJ_TASK":
        await service.cancel(sender.tab.id);
        return crossOjResponse(message.requestId, true, "cancelled");
    }
  } catch {
    return crossOjResponse(
      message.requestId,
      false,
      "cross-oj-operation-failed",
      {
        message: "跨 OJ 操作失败，请重新发起。",
      },
    );
  }
}

export function isCrossOjSubmitMessage(raw: unknown): boolean {
  return isCrossOjMessage(raw);
}
