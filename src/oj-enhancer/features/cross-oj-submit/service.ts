import { createKeyedSerialQueue } from "../../../platform/async/serial-queue";
import {
  codeforcesSubmissionFromUrl,
  parseCodeforcesSubmitUrl,
  parseLuoguCodeforcesProblem,
  problemIdsMatch,
} from "./problem";
import { matchCodeforcesLanguage } from "./language";
import {
  atCoderProblemIdsMatch,
  atcoderSubmissionFromUrl,
  atcoderSubmitUrl,
  parseAtCoderSubmitUrl,
  parseLuoguAtCoderProblem,
} from "./atcoder";
import { findAtCoderCpp23Language } from "./atcoder-language";
import { sameLuoguPageDocumentUrl } from "./luogu-problem";
import type {
  CrossOjEvaluationStatus,
  CrossOjSubmissionRecord,
  CrossOjFillResult,
  CrossOjFormInspection,
  CrossOjLanguageOption,
  CrossOjProblemRef,
  CrossOjSubmitTask,
  EditorSnapshot,
} from "./model";
import {
  readCrossOjHistory,
  updateCrossOjEvaluation,
  upsertCrossOjHistory,
} from "./history";

export const CROSS_OJ_TASK_PREFIX = "ojtrace:cross-oj-submit:";
export const CROSS_OJ_TASK_TTL_MS = 10 * 60_000;

export interface CrossOjStorage {
  get(key: string): Promise<CrossOjSubmitTask | undefined>;
  set(key: string, task: CrossOjSubmitTask): Promise<void>;
  remove(key: string): Promise<void>;
  getAll(): Promise<Record<string, unknown>>;
}

export interface CrossOjHistoryStorage {
  get(): Promise<unknown>;
  set(records: CrossOjSubmissionRecord[]): Promise<void>;
}

export interface CrossOjTabs {
  get(tabId: number): Promise<{ id?: number; url?: string }>;
  create(properties: {
    url: string;
    active: boolean;
  }): Promise<{ id?: number }>;
  update(tabId: number, properties: { url: string }): Promise<unknown>;
  remove(tabId: number): Promise<void>;
}

export interface CrossOjTargetAdapter {
  inspect(task: CrossOjSubmitTask): Promise<CrossOjFormInspection>;
  fill(
    task: CrossOjSubmitTask,
    languageValue: string,
    documentId?: string,
  ): Promise<CrossOjFillResult>;
}

export interface CrossOjServiceOptions {
  storage: CrossOjStorage;
  tabs: CrossOjTabs;
  adapter: CrossOjTargetAdapter;
  history?: CrossOjHistoryStorage;
  hasPermissions: (problem: CrossOjProblemRef) => Promise<boolean>;
  now?: () => number;
  scheduleExpiration?: (tabId: number, expiresAt: number) => Promise<void>;
  clearExpiration?: (tabId: number) => Promise<void>;
}

export interface ClaimOutcome {
  ok: boolean;
  code: string;
  message?: string;
  languageOptions?: Array<{ value: string; label: string }>;
  taskState?: CrossOjSubmitTask["state"];
  result?: CrossOjSubmitTask["result"];
  returnUrl?: string;
  problem?: CrossOjProblemRef;
}

function taskKey(tabId: number): string {
  return `${CROSS_OJ_TASK_PREFIX}${tabId}`;
}

type SubmitRoute =
  | { kind: "submit"; contestId?: string; index?: string }
  | { kind: "submission-list"; contestId: string }
  | { kind: "login" }
  | { kind: "other" }
  | undefined;

function parseTargetSubmitRoute(
  task: CrossOjSubmitTask,
  url: string,
): SubmitRoute {
  if (task.problem.oj === "codeforces") return parseCodeforcesSubmitUrl(url);
  const route = parseAtCoderSubmitUrl(url);
  if (route?.kind === "submit")
    return { kind: "submit", contestId: route.contestId };
  if (route?.kind === "submission-list") return route;
  return route;
}

function parseTargetSubmission(
  task: CrossOjSubmitTask,
  url: string,
): { submissionId: string; contestId: string } | undefined {
  if (task.problem.oj === "codeforces") {
    const submission = codeforcesSubmissionFromUrl(url);
    const match = /^\/(?:contest\/(\d+)\/|problemset\/)submission\//.exec(
      new URL(url).pathname,
    );
    const contestId = match?.[1] ?? task.problem.contestId;
    return submission ? { ...submission, contestId } : undefined;
  }
  return atcoderSubmissionFromUrl(url);
}

function isCodeforcesSubmissionListRoute(
  task: CrossOjSubmitTask,
  rawUrl: string,
): boolean {
  if (task.problem.oj !== "codeforces") return false;
  try {
    const url = new URL(rawUrl);
    if (url.origin !== "https://codeforces.com") return false;
    if (url.pathname === "/problemset/status") return true;
    const contest = /^\/contest\/(\d+)\/(?:status|my)\/?$/.exec(url.pathname);
    return contest?.[1] === task.problem.contestId;
  } catch {
    return false;
  }
}

function isAtCoderSubmissionListRoute(
  task: CrossOjSubmitTask,
  rawUrl: string,
): boolean {
  if (task.problem.oj !== "atcoder") return false;
  const route = parseAtCoderSubmitUrl(rawUrl);
  return (
    route?.kind === "submission-list" &&
    route.contestId === task.problem.contestId
  );
}

function safeLuoguProblemId(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (
      url.origin !== "https://www.luogu.com.cn" ||
      url.username ||
      url.password
    )
      return undefined;
    const queryIds = url.searchParams.getAll("pid");
    if (queryIds.length > 1) return undefined;
    const path = /^\/problem\/([^/]+)\/?$/.exec(url.pathname);
    const pathId = path ? decodeURIComponent(path[1]!) : undefined;
    if (
      pathId &&
      queryIds[0] &&
      pathId.toUpperCase() !== queryIds[0].toUpperCase()
    )
      return undefined;
    return queryIds[0] ?? pathId;
  } catch {
    return undefined;
  }
}

function atcoderCrossOjSubmitUrl(
  problem: Extract<CrossOjProblemRef, { oj: "atcoder" }>,
): string {
  const url = new URL(atcoderSubmitUrl(problem));
  url.searchParams.set("ojtrace", "1");
  return url.href;
}

function validEditorSnapshot(editor: EditorSnapshot): boolean {
  return (
    editor.code.trim().length > 0 &&
    editor.code.length <= 256_000 &&
    editor.luoguLanguage.trim().length > 0 &&
    editor.luoguLanguage.length <= 120 &&
    editor.editorKind.length <= 80 &&
    Number.isFinite(editor.capturedAt)
  );
}

function isChallengeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      ((url.hostname === "codeforces.com" || url.hostname === "atcoder.jp") &&
        /challenge|cdn-cgi|captcha/i.test(`${url.pathname} ${url.search}`)) ||
      (url.hostname === "challenges.cloudflare.com" &&
        url.pathname.startsWith("/cdn-cgi/challenge-platform/"))
    );
  } catch {
    return false;
  }
}

export class CrossOjSubmitService {
  private readonly now: () => number;
  private readonly runByTab = createKeyedSerialQueue();
  private readonly runHistory = createKeyedSerialQueue();

  constructor(private readonly options: CrossOjServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async create(input: {
    sourceTabId: number;
    sourceUrl: string;
    problem: CrossOjProblemRef;
    editor: EditorSnapshot;
  }): Promise<{ targetTabId: number; targetUrl?: string }> {
    if (!(await this.options.hasPermissions(input.problem)))
      throw new Error("请先授予洛谷和目标 OJ 的站点访问权限。");
    const sourceTab = await this.options.tabs.get(input.sourceTabId);
    const sourceUrl = sourceTab.url;
    if (!sourceUrl || !sameLuoguPageDocumentUrl(sourceUrl, input.sourceUrl))
      throw new Error("洛谷页面已变化，请重新读取代码后再试。");
    const luoguProblemId = safeLuoguProblemId(sourceUrl);
    const pidProblem = luoguProblemId
      ? input.problem.oj === "codeforces"
        ? parseLuoguCodeforcesProblem(luoguProblemId)
        : parseLuoguAtCoderProblem(luoguProblemId, input.problem.originUrl)
      : undefined;
    const problemMatches =
      input.problem.oj === "codeforces"
        ? !!pidProblem &&
          pidProblem.oj === "codeforces" &&
          /^\d+$/.test(input.problem.contestId) &&
          /^[A-Z]\d*$/i.test(input.problem.index) &&
          problemIdsMatch(pidProblem, input.problem)
        : !!pidProblem &&
          pidProblem.oj === "atcoder" &&
          atCoderProblemIdsMatch(pidProblem, input.problem);
    if (!problemMatches) throw new Error("当前洛谷题号与目标 OJ 题号不一致。");
    if (!validEditorSnapshot(input.editor))
      throw new Error("代码或语言信息无效，请重新读取编辑器。");

    // Use one native target tab for both OJs. This preserves the source tab's
    // logged-in browser session and lets the target page own its first-party
    // security challenge without creating an extra helper tab.
    const reuseSourceTab = true;
    const target = reuseSourceTab
      ? { id: input.sourceTabId }
      : await this.options.tabs.create({ url: "about:blank", active: true });
    if (typeof target.id !== "number")
      throw new Error("无法创建目标 OJ 标签页。");
    const now = this.now();
    const targetUrl =
      input.problem.oj === "codeforces"
        ? `https://codeforces.com/problemset/submit?${new URLSearchParams({ contestId: input.problem.contestId, problemIndex: input.problem.index, ojtrace: "1" })}`
        : atcoderCrossOjSubmitUrl(input.problem);
    const task: CrossOjSubmitTask = {
      sourceTabId: input.sourceTabId,
      sourceUrl,
      targetOrigin:
        input.problem.oj === "codeforces"
          ? "https://codeforces.com"
          : "https://atcoder.jp",
      targetTabId: target.id,
      problem: input.problem,
      editor: input.editor,
      createdAt: now,
      expiresAt: now + CROSS_OJ_TASK_TTL_MS,
      state: "pending",
    };
    try {
      await this.options.storage.set(taskKey(target.id), task);
      await this.options.scheduleExpiration?.(target.id, task.expiresAt);
      if (!reuseSourceTab)
        await this.options.tabs.update(target.id, { url: targetUrl });
    } catch (error) {
      await this.options.storage.remove(taskKey(target.id)).catch(() => {});
      await this.options.clearExpiration?.(target.id).catch(() => {});
      if (!reuseSourceTab)
        await this.options.tabs.remove(target.id).catch(() => {});
      throw error;
    }
    return {
      targetTabId: target.id,
      targetUrl,
    };
  }

  async claim(
    tabId: number,
    targetLanguageValue?: string,
  ): Promise<ClaimOutcome> {
    return this.runByTab(String(tabId), async () => {
      const task = await this.options.storage.get(taskKey(tabId));
      if (!task) return { ok: false, code: "task-not-found" };
      const tab = await this.options.tabs.get(tabId);
      if (!tab.url || typeof tab.id !== "number") {
        await this.remove(task);
        return { ok: false, code: "target-page-changed" };
      }
      if (this.now() >= task.expiresAt) {
        await this.remove(task);
        return { ok: false, code: "expired" };
      }
      let current: URL;
      try {
        current = new URL(tab.url);
      } catch {
        await this.remove(task);
        return { ok: false, code: "target-page-changed" };
      }
      if (current.origin !== task.targetOrigin) {
        await this.remove(task);
        return { ok: false, code: "target-page-changed" };
      }
      if (task.state === "awaiting-user-submit")
        return {
          ok: true,
          code: "awaiting-user-submit",
          taskState: task.state,
        };
      if (task.state === "submitting" || task.state === "observing-result")
        return {
          ok: true,
          code: "submission-in-progress",
          taskState: task.state,
          returnUrl: task.sourceUrl,
          problem: task.problem,
        };
      if (task.state !== "pending")
        return {
          ok: false,
          code: "task-already-claimed",
          taskState: task.state,
        };
      const route = parseTargetSubmitRoute(task, tab.url);
      if (route?.kind === "login") return { ok: false, code: "login-required" };
      if (isChallengeUrl(tab.url)) return { ok: false, code: "security-check" };
      if (route?.kind !== "submit")
        return { ok: false, code: "unsupported-page" };
      if (
        (route.contestId && route.contestId !== task.problem.contestId) ||
        (task.problem.oj === "codeforces" &&
          route.index &&
          route.index !== task.problem.index)
      ) {
        await this.remove(task);
        return { ok: false, code: "target-page-changed" };
      }
      const inspection = await this.options.adapter.inspect(task);
      if (inspection.status === "login-required")
        return { ok: false, code: "login-required" };
      if (inspection.status === "security-check")
        return { ok: false, code: "security-check" };
      if (inspection.status === "form-unavailable")
        return { ok: false, code: "form-unavailable" };
      if (inspection.status === "problem-mismatch") {
        await this.remove(task);
        return { ok: false, code: "target-page-changed" };
      }
      if (
        inspection.status === "ready" &&
        inspection.problemMatches === false
      ) {
        await this.remove(task);
        return { ok: false, code: "target-page-changed" };
      }
      if (inspection.status === "editor-unavailable") {
        return { ok: false, code: "editor-unavailable" };
      }
      if (inspection.codePresent) return { ok: false, code: "existing-code" };

      let selectedLanguage: CrossOjLanguageOption | undefined;
      if (task.problem.oj === "atcoder") {
        selectedLanguage = findAtCoderCpp23Language(inspection.languageOptions);
        if (!selectedLanguage)
          return { ok: false, code: "unsupported-language" };
      } else {
        const language = targetLanguageValue
          ? inspection.languageOptions.find(
              (option) => option.value === targetLanguageValue,
            )
          : undefined;
        const match = matchCodeforcesLanguage(
          task.editor?.luoguLanguage ?? "",
          inspection.languageOptions,
        );
        if (
          match.kind === "unsupported" ||
          (match.kind === "matched" &&
            targetLanguageValue !== undefined &&
            targetLanguageValue !== match.option.value)
        )
          return { ok: false, code: "unsupported-language" };
        if (
          targetLanguageValue &&
          (match.kind !== "ambiguous" ||
            !match.options.some(
              (option) => option.value === targetLanguageValue,
            ))
        )
          return { ok: false, code: "language-mismatch" };
        selectedLanguage =
          language ?? (match.kind === "matched" ? match.option : undefined);
        if (!selectedLanguage) {
          return {
            ok: false,
            code: "language-selection-required",
            languageOptions: match.kind === "ambiguous" ? match.options : [],
          };
        }
      }
      if (!task.editor) {
        await this.remove(task);
        return { ok: false, code: "editor-unavailable" };
      }

      // Persist the one-time claim before code reaches the page. If filling or
      // the response fails, the task will never be automatically replayed.
      const claimed: CrossOjSubmitTask = {
        ...task,
        state: "submitting",
      };
      await this.options.storage.set(taskKey(tabId), claimed);
      let fill: CrossOjFillResult;
      try {
        fill = await this.options.adapter.fill(
          claimed,
          selectedLanguage.value,
          inspection.documentId,
        );
      } catch {
        const uncertain: CrossOjSubmitTask = {
          ...claimed,
          state: "submitting",
        };
        delete uncertain.editor;
        await this.options.storage.set(taskKey(tabId), uncertain);
        return { ok: false, code: "submission-uncertain" };
      }
      if (fill.status === "existing-code") {
        // The page may have changed after inspection; preserve user data.
        await this.fail(claimed, "target-page-changed");
        return { ok: false, code: "existing-code" };
      }
      if (
        fill.status === "submit-triggered" ||
        fill.status === "submit-attempted"
      ) {
        const observing: CrossOjSubmitTask = {
          ...claimed,
          state: "observing-result",
          submitObservedAt: this.now(),
        };
        delete observing.editor;
        await this.options.storage.set(taskKey(tabId), observing);
        return {
          ok: true,
          code:
            fill.status === "submit-triggered"
              ? "submission-triggered"
              : "submission-attempted",
          taskState: observing.state,
          returnUrl: task.sourceUrl,
          problem: task.problem,
        };
      }
      if (fill.status === "submit-uncertain") {
        const uncertain: CrossOjSubmitTask = { ...claimed };
        delete uncertain.editor;
        await this.options.storage.set(taskKey(tabId), uncertain);
        return { ok: false, code: "submission-uncertain" };
      }
      if (fill.status === "submit-blocked") {
        await this.fail(claimed, "internal-error");
        return { ok: false, code: `submit-blocked-${fill.reason}` };
      }
      if (fill.status !== "filled") {
        await this.fail(
          claimed,
          fill.status === "problem-mismatch"
            ? "target-page-changed"
            : fill.status === "editor-unavailable"
              ? "editor-unavailable"
              : "internal-error",
        );
        return {
          ok: false,
          code: "fill-failed",
        };
      }
      const awaiting: CrossOjSubmitTask = {
        ...claimed,
        state: "awaiting-user-submit",
      };
      delete awaiting.editor;
      await this.options.storage.set(taskKey(tabId), awaiting);
      return { ok: true, code: "filled", taskState: awaiting.state };
    });
  }

  async update(
    tabId: number,
    currentUrl: string,
    event:
      | { kind: "submit-observed"; submitUrl: string }
      | { kind: "result-unmatched" }
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
        },
  ): Promise<ClaimOutcome> {
    return this.runByTab(String(tabId), async () => {
      const task = await this.options.storage.get(taskKey(tabId));
      if (!task) return { ok: false, code: "task-not-found" };
      if (this.now() >= task.expiresAt) {
        await this.remove(task);
        return { ok: false, code: "expired" };
      }
      const tab = await this.options.tabs.get(tabId);
      let current: URL;
      try {
        current = new URL(currentUrl);
      } catch {
        return { ok: false, code: "target-page-changed" };
      }
      if (current.origin !== task.targetOrigin)
        return { ok: false, code: "target-page-changed" };
      if (event.kind === "submit-observed") {
        const submitRoute = parseTargetSubmitRoute(task, event.submitUrl);
        const actualUrl = tab.url
          ? !!parseTargetSubmission(task, tab.url)
          : undefined;
        const alreadyObserving = task.state === "observing-result";
        if (
          (!alreadyObserving &&
            task.state !== "awaiting-user-submit" &&
            task.state !== "submitting") ||
          submitRoute?.kind !== "submit" ||
          (submitRoute.contestId &&
            submitRoute.contestId !== task.problem.contestId) ||
          (task.problem.oj === "codeforces" &&
            "index" in submitRoute &&
            submitRoute.index &&
            submitRoute.index !== task.problem.index) ||
          (tab.url !== event.submitUrl && !actualUrl)
        )
          return { ok: false, code: "invalid-transition" };
        if (alreadyObserving)
          return {
            ok: true,
            code: "observing-result",
            taskState: task.state,
          };
        const updated: CrossOjSubmitTask = {
          ...task,
          state: "observing-result",
          submitObservedAt: this.now(),
        };
        await this.options.storage.set(taskKey(tabId), updated);
        return { ok: true, code: "observing-result", taskState: updated.state };
      }
      if (tab.url !== currentUrl)
        return { ok: false, code: "target-page-changed" };
      if (event.kind === "result-unmatched") {
        // An unrelated submission detail page must never consume a task.
        // A Codeforces status list reached by this same one-shot task is also
        // a valid terminal page when the site does not expose a unique detail
        // URL. Never guess the newest row or replay the submission.
        const statusListAfterSubmit =
          (task.state === "submitting" || task.state === "observing-result") &&
          (task.problem.oj === "codeforces"
            ? isCodeforcesSubmissionListRoute(task, current.href)
            : isAtCoderSubmissionListRoute(task, current.href));
        if (task.state !== "observing-result" && !statusListAfterSubmit)
          return { ok: false, code: "invalid-transition" };
        const updated: CrossOjSubmitTask = {
          ...task,
          state: "result-unknown",
          errorCode: "result-unmatched",
        };
        delete updated.editor;
        try {
          await this.options.storage.set(taskKey(tabId), updated);
        } finally {
          await this.remove(updated).catch(() => {});
        }
        return {
          ok: true,
          code: "result-unknown",
          taskState: updated.state,
          returnUrl: task.sourceUrl,
        };
      }
      if (task.state !== "observing-result")
        return { ok: false, code: "invalid-transition" };
      let detailUrl: URL;
      try {
        detailUrl = new URL(event.detailUrl);
      } catch {
        return { ok: false, code: "result-unmatched" };
      }
      const resultMatches =
        "index" in event
          ? task.problem.oj === "codeforces" &&
            parseTargetSubmission(task, detailUrl.href)?.contestId ===
              task.problem.contestId &&
            detailUrl.href === currentUrl &&
            detailUrl.origin === task.targetOrigin &&
            codeforcesSubmissionFromUrl(detailUrl.href)?.submissionId ===
              event.submissionId &&
            problemIdsMatch(
              {
                oj: "codeforces",
                contestId: event.contestId,
                index: event.index.toUpperCase(),
                source: "luogu-pid",
              },
              task.problem,
            )
          : task.problem.oj === "atcoder" &&
            parseTargetSubmission(task, detailUrl.href)?.contestId ===
              task.problem.contestId &&
            detailUrl.href === currentUrl &&
            detailUrl.origin === task.targetOrigin &&
            atcoderSubmissionFromUrl(detailUrl.href)?.submissionId ===
              event.submissionId &&
            atCoderProblemIdsMatch(
              {
                oj: "atcoder",
                contestId: event.contestId,
                taskId: event.taskId,
                source: "luogu-pid",
              },
              task.problem,
            );
      if (!resultMatches) return { ok: false, code: "result-unmatched" };
      const updated: CrossOjSubmitTask = {
        ...task,
        state: "completed",
        result: {
          submissionId: event.submissionId,
          detailUrl: detailUrl.href,
          observedAt: this.now(),
        },
      };
      delete updated.editor;
      const history = this.options.history;
      let message: string | undefined;
      if (history) {
        const problemId =
          task.problem.oj === "codeforces"
            ? `${task.problem.contestId}/${task.problem.index}`
            : task.problem.taskId;
        await this.runHistory("records", async () => {
          await history.set(
            upsertCrossOjHistory(await history.get(), {
              oj: task.problem.oj,
              submissionId: event.submissionId,
              problemId,
              detailUrl: detailUrl.href,
              observedAt: this.now(),
              evaluationStatus: "unknown",
              statusUpdatedAt: this.now(),
            }),
          );
        }).catch(() => {
          message = "已识别提交，但本地历史保存失败。请在目标站查看评测结果。";
        });
      }
      try {
        await this.options.storage.set(taskKey(tabId), updated);
      } finally {
        await this.remove(updated).catch(() => {});
      }
      return {
        ok: true,
        code: "completed",
        taskState: updated.state,
        result: updated.result,
        returnUrl: task.sourceUrl,
        message,
      };
    });
  }

  async getHistory(): Promise<CrossOjSubmissionRecord[]> {
    return readCrossOjHistory(await this.options.history?.get());
  }

  async clearHistory(): Promise<void> {
    await this.runHistory("records", async () => {
      await this.options.history?.set([]);
    });
  }

  async updateEvaluation(input: {
    currentUrl: string;
    detailUrl: string;
    submissionId: string;
    evaluationStatus: CrossOjEvaluationStatus;
  }): Promise<{ ok: boolean; code: string }> {
    let current: URL;
    let detail: URL;
    try {
      current = new URL(input.currentUrl);
      detail = new URL(input.detailUrl);
    } catch {
      return { ok: false, code: "invalid-detail-url" };
    }
    if (current.href !== detail.href || !/^\d{1,20}$/.test(input.submissionId))
      return { ok: false, code: "invalid-detail-url" };
    const cf = codeforcesSubmissionFromUrl(detail.href);
    const atcoder = atcoderSubmissionFromUrl(detail.href);
    const oj = cf ? "codeforces" : atcoder ? "atcoder" : undefined;
    const parsedId = cf?.submissionId ?? atcoder?.submissionId;
    if (
      !oj ||
      parsedId !== input.submissionId ||
      detail.origin !==
        (oj === "codeforces" ? "https://codeforces.com" : "https://atcoder.jp")
    )
      return { ok: false, code: "invalid-detail-url" };
    return this.runHistory("records", async () => {
      const records = await this.options.history?.get();
      const updated = updateCrossOjEvaluation(records, {
        detailUrl: detail.href,
        submissionId: input.submissionId,
        evaluationStatus: input.evaluationStatus,
        updatedAt: this.now(),
      });
      if (!updated) return { ok: false, code: "submission-not-found" };
      await this.options.history?.set(updated);
      return { ok: true, code: "evaluation-updated" };
    });
  }

  async cancel(tabId: number): Promise<void> {
    await this.runByTab(String(tabId), async () => {
      const task = await this.options.storage.get(taskKey(tabId));
      if (task) await this.remove(task);
    });
  }

  async onTabRemoved(tabId: number): Promise<void> {
    await this.cancel(tabId);
    const entries = await this.options.storage.getAll();
    for (const [key, value] of Object.entries(entries)) {
      if (
        key.startsWith(CROSS_OJ_TASK_PREFIX) &&
        isTask(value) &&
        value.sourceTabId === tabId
      )
        await this.cancel(value.targetTabId);
    }
  }

  async onTabUrlUpdated(tabId: number, url: string): Promise<void> {
    return this.runByTab(String(tabId), async () => {
      const task = await this.options.storage.get(taskKey(tabId));
      if (!task) return;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        await this.remove(task);
        return;
      }
      const challenge = isChallengeUrl(url);
      if (parsed.origin !== task.targetOrigin && !challenge) {
        await this.remove(task);
        return;
      }
      const isSubmit = parseTargetSubmitRoute(task, url)?.kind === "submit";
      const isSubmissionDetail = !!parseTargetSubmission(task, url);
      const isSubmissionList =
        task.problem.oj === "codeforces"
          ? isCodeforcesSubmissionListRoute(task, url)
          : isAtCoderSubmissionListRoute(task, url);
      const isLogin =
        task.problem.oj === "codeforces"
          ? /^\/enter(?:\/|$)/.test(parsed.pathname)
          : /^\/login(?:\/|$)/.test(parsed.pathname);
      if (task.state === "pending") {
        if (isSubmit || isLogin || challenge || parsed.pathname === "/") return;
        await this.remove(task);
        return;
      }
      // A submission detail is only valid after this task's own native submit
      // event was observed. Otherwise an unrelated same-tab detail page could
      // keep stale code/task state alive or be mistaken for this task's result.
      if (task.state === "observing-result" || task.state === "submitting") {
        if (isSubmissionDetail || isSubmissionList || challenge) return;
        await this.remove(task);
        return;
      }
      if (task.state === "awaiting-user-submit" && isSubmissionDetail) return;
      if (!isSubmit) await this.remove(task);
    });
  }

  async cleanupExpired(): Promise<void> {
    const entries = await this.options.storage.getAll();
    for (const [key, value] of Object.entries(entries)) {
      if (
        key.startsWith(CROSS_OJ_TASK_PREFIX) &&
        isTask(value) &&
        this.now() >= value.expiresAt
      ) {
        await this.expire(value.targetTabId);
      }
    }
  }

  async rearmExpirations(): Promise<void> {
    const entries = await this.options.storage.getAll();
    for (const value of Object.values(entries)) {
      if (isTask(value) && this.now() < value.expiresAt)
        await this.options.scheduleExpiration?.(
          value.targetTabId,
          value.expiresAt,
        );
    }
  }

  async expire(tabId: number): Promise<void> {
    return this.runByTab(String(tabId), async () => {
      const task = await this.options.storage.get(taskKey(tabId));
      if (!task) return;
      if (this.now() >= task.expiresAt) {
        await this.remove(task);
        return;
      }
      await this.options.scheduleExpiration?.(tabId, task.expiresAt);
    });
  }

  private async fail(
    task: CrossOjSubmitTask,
    errorCode: NonNullable<CrossOjSubmitTask["errorCode"]>,
  ): Promise<void> {
    const failed: CrossOjSubmitTask = {
      ...task,
      state: "failed",
      errorCode,
    };
    delete failed.editor;
    try {
      await this.options.storage.set(taskKey(task.targetTabId), failed);
    } finally {
      await this.remove(failed).catch(() => {});
    }
  }

  private async remove(task: CrossOjSubmitTask): Promise<void> {
    try {
      await this.options.storage.remove(taskKey(task.targetTabId));
    } finally {
      await this.options.clearExpiration?.(task.targetTabId);
    }
  }
}

function isTask(value: unknown): value is CrossOjSubmitTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<CrossOjSubmitTask>;
  return (
    typeof task.targetTabId === "number" &&
    typeof task.sourceTabId === "number" &&
    typeof task.expiresAt === "number" &&
    !!task.problem
  );
}
