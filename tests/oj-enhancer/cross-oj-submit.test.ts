import { describe, expect, it, vi } from "vitest";
import {
  parseCodeforcesProblemUrl,
  parseCodeforcesSubmitUrl,
  parseLuoguCodeforcesProblem,
  codeforcesSubmissionFromUrl,
} from "../../src/oj-enhancer/features/cross-oj-submit/problem";
import { matchCodeforcesLanguage } from "../../src/oj-enhancer/features/cross-oj-submit/language";
import {
  CrossOjSubmitService,
  CROSS_OJ_TASK_PREFIX,
} from "../../src/oj-enhancer/features/cross-oj-submit/service";
import type {
  CrossOjFillResult,
  CrossOjFormInspection,
  CrossOjSubmitTask,
} from "../../src/oj-enhancer/features/cross-oj-submit/model";

describe("cross OJ problem and route parsing", () => {
  it("parses only unambiguous Codeforces references", () => {
    expect(parseLuoguCodeforcesProblem("CF1A")).toMatchObject({
      contestId: "1",
      index: "A",
    });
    expect(parseLuoguCodeforcesProblem("CF1936C")).toMatchObject({
      contestId: "1936",
      index: "C",
    });
    expect(parseLuoguCodeforcesProblem("CF1")).toBeUndefined();
    expect(parseLuoguCodeforcesProblem("AT_abc175_f")).toBeUndefined();
    expect(
      parseCodeforcesProblemUrl(
        "https://codeforces.com/contest/1936/problem/C",
      ),
    ).toMatchObject({ contestId: "1936", index: "C" });
    expect(
      parseCodeforcesProblemUrl(
        "https://codeforces.com.evil.example/contest/1/problem/A",
      ),
    ).toBeUndefined();
  });

  it("parses submit and result routes without guessing from a list page", () => {
    expect(
      parseCodeforcesSubmitUrl(
        "https://codeforces.com/problemset/submit?contestId=1&problemIndex=A",
      ),
    ).toMatchObject({ kind: "submit", contestId: "1", index: "A" });
    expect(parseCodeforcesSubmitUrl("https://codeforces.com/enter")).toEqual({
      kind: "login",
    });
    expect(
      codeforcesSubmissionFromUrl(
        "https://codeforces.com/contest/1/submission/123",
      ),
    ).toEqual({ submissionId: "123" });
    expect(
      codeforcesSubmissionFromUrl("https://codeforces.com/submissions"),
    ).toBeUndefined();
  });
});

describe("Codeforces language matching", () => {
  const options = [
    { value: "54", label: "GNU C++17" },
    { value: "61", label: "GNU C++20 (64)" },
    { value: "31", label: "Python 3" },
  ];

  it("matches current options and refuses unsupported languages", () => {
    expect(matchCodeforcesLanguage("C++17", options)).toEqual({
      kind: "matched",
      option: options[0],
    });
    expect(matchCodeforcesLanguage("Python 3.11", options)).toEqual({
      kind: "matched",
      option: options[2],
    });
    expect(matchCodeforcesLanguage("Pascal", options)).toEqual({
      kind: "unsupported",
    });
  });

  it("requires a user choice when multiple target options match", () => {
    expect(
      matchCodeforcesLanguage("C++20", [
        { value: "1", label: "GNU C++20" },
        { value: "2", label: "GNU C++20 (64)" },
      ]),
    ).toMatchObject({ kind: "ambiguous" });
  });
});

function setupService(now = () => 1_000) {
  const entries = new Map<string, CrossOjSubmitTask>();
  const tabs = new Map<number, { id: number; url: string }>([
    [7, { id: 7, url: "https://www.luogu.com.cn/problem/CF1A" }],
    [8, { id: 8, url: "https://www.luogu.com.cn/problem/CF1A" }],
  ]);
  let nextTabId = 20;
  const storage = {
    get: vi.fn(async (key: string) => entries.get(key)),
    set: vi.fn(async (key: string, task: CrossOjSubmitTask) => {
      entries.set(key, task);
    }),
    remove: vi.fn(async (key: string) => {
      entries.delete(key);
    }),
    getAll: vi.fn(async () => Object.fromEntries(entries)),
  };
  let historyEntries: unknown = [];
  const history = {
    get: vi.fn(async () => historyEntries),
    set: vi.fn(async (records: unknown) => {
      historyEntries = records;
    }),
  };
  const tabApi = {
    get: vi.fn(async (tabId: number) => {
      const tab = tabs.get(tabId);
      if (!tab) throw new Error("tab not found");
      const task = entries.get(`${CROSS_OJ_TASK_PREFIX}${tabId}`);
      if (
        tab.url.startsWith("https://www.luogu.com.cn/") &&
        task?.problem.oj === "codeforces"
      )
        return {
          ...tab,
          url: `https://codeforces.com/problemset/submit?${new URLSearchParams({ contestId: task.problem.contestId, problemIndex: task.problem.index })}`,
        };
      return tab;
    }),
    create: vi.fn(async ({ url }: { url: string }) => {
      const id = nextTabId++;
      tabs.set(id, { id, url });
      return { id };
    }),
    update: vi.fn(async (tabId: number, { url }: { url: string }) => {
      tabs.set(tabId, { id: tabId, url });
    }),
    remove: vi.fn(async (tabId: number) => {
      tabs.delete(tabId);
    }),
  };
  const adapter = {
    inspect: vi.fn(async (): Promise<CrossOjFormInspection> => ({
      status: "ready" as const,
      languageOptions: [{ value: "54", label: "GNU C++17" }],
      codePresent: false,
      problemMatches: true,
    })),
    fill: vi.fn(async (task: CrossOjSubmitTask): Promise<CrossOjFillResult> =>
      task.problem.oj === "codeforces"
        ? {
            status: "submit-triggered" as const,
            languageLabel: "GNU C++17",
          }
        : { status: "filled" as const, languageLabel: "GNU C++17" },
    ),
  };
  const scheduleExpiration = vi.fn(async () => undefined);
  const clearExpiration = vi.fn(async () => undefined);
  const service = new CrossOjSubmitService({
    storage,
    tabs: tabApi,
    adapter,
    history,
    hasPermissions: async () => true,
    now,
    scheduleExpiration,
    clearExpiration,
  });
  return {
    service,
    storage,
    tabs,
    tabApi,
    adapter,
    entries,
    scheduleExpiration,
    clearExpiration,
    getHistoryEntries: () => historyEntries,
    history,
  };
}

const cfInput = {
  sourceTabId: 7,
  sourceUrl: "https://www.luogu.com.cn/problem/CF1A",
  problem: {
    oj: "codeforces",
    contestId: "1",
    index: "A",
    source: "luogu-pid",
  },
  editor: {
    code: "int main() {}",
    luoguLanguage: "C++17",
    editorKind: "textarea",
    capturedAt: 1,
  },
} as const;

describe("cross OJ task lifecycle", () => {
  it("serializes actual competing claims and pins fill to the inspected document", async () => {
    const { service, adapter } = setupService();
    adapter.inspect.mockResolvedValue({
      status: "ready",
      codePresent: false,
      languageOptions: [{ value: "54", label: "GNU C++17" }],
      documentId: "document-a",
    });
    const { targetTabId } = await service.create(cfInput);
    const outcomes = await Promise.all([
      service.claim(targetTabId),
      service.claim(targetTabId),
    ]);
    expect(outcomes.map((outcome) => outcome.code)).toEqual([
      "submission-triggered",
      "submission-in-progress",
    ]);
    expect(adapter.fill).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      "54",
      "document-a",
    );
  });

  it("does not resurrect a task when the tab closes during a fill", async () => {
    const { service, adapter, entries } = setupService();
    let release!: () => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    adapter.fill.mockImplementation(async () => {
      began();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: "submit-triggered", languageLabel: "GNU C++17" };
    });
    const { targetTabId } = await service.create(cfInput);
    const claim = service.claim(targetTabId);
    await started;
    const removal = service.onTabRemoved(targetTabId);
    release();
    await Promise.all([claim, removal]);
    expect(entries.size).toBe(0);
  });

  it("does not replay a Codeforces submit when the native page response is uncertain", async () => {
    const { service, adapter, entries } = setupService();
    adapter.fill.mockRejectedValueOnce(new Error("navigation interrupted"));
    const { targetTabId } = await service.create(cfInput);

    expect(await service.claim(targetTabId)).toMatchObject({
      ok: false,
      code: "submission-uncertain",
    });
    const task = entries.get(`${CROSS_OJ_TASK_PREFIX}${targetTabId}`);
    expect(task?.state).toBe("submitting");
    expect(task).not.toHaveProperty("editor");
    expect(await service.claim(targetTabId)).toMatchObject({
      ok: true,
      code: "submission-in-progress",
    });
    expect(adapter.fill).toHaveBeenCalledOnce();
  });

  it("expires a pending task with no code replay", async () => {
    let now = 1_000;
    const { service, entries, clearExpiration, adapter } = setupService(
      () => now,
    );
    const { targetTabId } = await service.create(cfInput);
    now += 600_001;
    await service.expire(targetTabId);
    expect(entries.size).toBe(0);
    expect(clearExpiration).toHaveBeenCalledWith(targetTabId);
    expect(await service.claim(targetTabId)).toMatchObject({
      code: "task-not-found",
    });
    expect(adapter.fill).not.toHaveBeenCalled();
  });

  it("keeps both concurrent result summaries and denies updates from other detail pages", async () => {
    const { service, tabs, entries, history } = setupService();
    const first = await service.create(cfInput);
    const second = await service.create({ ...cfInput, sourceTabId: 8 });
    const results = await Promise.all(
      [first, second].map(async ({ targetTabId }, index) => {
        await service.claim(targetTabId);
        const submitUrl = tabs.get(targetTabId)!.url;
        await service.update(targetTabId, submitUrl, {
          kind: "submit-observed",
          submitUrl,
        });
        const submissionId = String(100 + index);
        const detailUrl = `https://codeforces.com/contest/1/submission/${submissionId}`;
        tabs.set(targetTabId, { id: targetTabId, url: detailUrl });
        return service.update(targetTabId, detailUrl, {
          kind: "result-observed",
          submissionId,
          detailUrl,
          contestId: "1",
          index: "A",
        });
      }),
    );
    expect(results.every((result) => result.code === "completed")).toBe(true);
    expect(await service.getHistory()).toHaveLength(2);
    expect(entries.size).toBe(0);
    expect(
      await service.updateEvaluation({
        currentUrl: "https://codeforces.com/contest/1/submission/101",
        detailUrl: "https://codeforces.com/contest/1/submission/100",
        submissionId: "100",
        evaluationStatus: "accepted",
      }),
    ).toMatchObject({ ok: false });
    history.set.mockRejectedValueOnce(new Error("quota exceeded"));
    await expect(service.clearHistory()).rejects.toThrow("quota exceeded");
    await service.clearHistory();
    expect(await service.getHistory()).toEqual([]);
  });

  it("runs an AtCoder task through native prefill and correlated result cleanup", async () => {
    const {
      service,
      tabs,
      adapter,
      entries,
      clearExpiration,
      getHistoryEntries,
    } = setupService();
    tabs.set(7, {
      id: 7,
      url: "https://www.luogu.com.cn/problem/AT_abc175_f",
    });
    adapter.inspect.mockResolvedValue({
      status: "ready",
      languageOptions: [{ value: "6000", label: "C++20 (GCC 12.2.0)" }],
      codePresent: false,
      problemMatches: true,
    });
    const target = await service.create({
      sourceTabId: 7,
      sourceUrl: "https://www.luogu.com.cn/problem/AT_abc175_f",
      problem: {
        oj: "atcoder",
        contestId: "abc175",
        taskId: "abc175_f",
        source: "luogu-pid",
      },
      editor: {
        code: "int main() {}",
        luoguLanguage: "C++20",
        editorKind: "monaco",
        capturedAt: 1,
      },
    });
    expect(tabs.get(target.targetTabId)?.url).toBe(
      "https://atcoder.jp/contests/abc175/submit",
    );
    expect(await service.claim(target.targetTabId)).toMatchObject({
      ok: true,
      code: "filled",
    });

    const submitUrl = "https://atcoder.jp/contests/abc175/submit";
    const detailUrl = "https://atcoder.jp/contests/abc175/submissions/987654";
    tabs.set(target.targetTabId, { id: target.targetTabId, url: detailUrl });
    expect(
      await service.update(target.targetTabId, detailUrl, {
        kind: "submit-observed",
        submitUrl,
      }),
    ).toMatchObject({ ok: true, code: "observing-result" });
    const completed = await service.update(target.targetTabId, detailUrl, {
      kind: "result-observed",
      oj: "atcoder",
      submissionId: "987654",
      detailUrl,
      contestId: "abc175",
      taskId: "abc175_f",
    });
    expect(completed).toMatchObject({ ok: true, code: "completed" });
    expect(entries.has(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)).toBe(
      false,
    );
    expect(clearExpiration).toHaveBeenCalledWith(target.targetTabId);
    expect(getHistoryEntries()).toMatchObject([
      {
        oj: "atcoder",
        submissionId: "987654",
        problemId: "abc175_f",
        evaluationStatus: "unknown",
      },
    ]);
    expect(JSON.stringify(getHistoryEntries())).not.toContain("int main");
    expect(
      await service.updateEvaluation({
        currentUrl: detailUrl,
        detailUrl,
        submissionId: "987654",
        evaluationStatus: "accepted",
      }),
    ).toEqual({ ok: true, code: "evaluation-updated" });
    expect(await service.getHistory()).toMatchObject([
      { submissionId: "987654", evaluationStatus: "accepted" },
    ]);
    await service.clearHistory();
    expect(await service.getHistory()).toEqual([]);
  });

  it("creates the submit route from the verified original AtCoder task link", async () => {
    const { service, tabs } = setupService();
    const pageUrl = "https://www.luogu.com.cn/problem/AT1202Contest_h";
    tabs.set(7, { id: 7, url: `${pageUrl}#submit` });
    const problem = {
      oj: "atcoder" as const,
      contestId: "degwer2023",
      taskId: "1202contest_h",
      source: "luogu-origin-link" as const,
      originUrl: "https://atcoder.jp/contests/DEGwer2023/tasks/1202Contest_h",
    };

    const target = await service.create({
      sourceTabId: 7,
      sourceUrl: pageUrl,
      problem,
      editor: {
        code: "print(1)",
        luoguLanguage: "Python 3",
        editorKind: "luogu-vue-codemirror-model",
        capturedAt: 1,
      },
    });

    expect(tabs.get(target.targetTabId)?.url).toBe(
      "https://atcoder.jp/contests/degwer2023/submit",
    );
  });

  it("reuses the Luogu tab for Codeforces and claims code only once", async () => {
    const { service, storage, tabApi, adapter, entries, scheduleExpiration } =
      setupService();
    const target = await service.create({
      sourceTabId: 7,
      sourceUrl: "https://www.luogu.com.cn/problem/CF1A",
      problem: {
        oj: "codeforces",
        contestId: "1",
        index: "A",
        source: "luogu-pid",
      },
      editor: {
        code: "#include <bits/stdc++.h>\nint main() {}",
        luoguLanguage: "C++17",
        editorKind: "monaco",
        capturedAt: 1,
      },
    });
    expect(target.targetTabId).toBe(7);
    expect(target.targetUrl).toBe(
      "https://codeforces.com/problemset/submit?contestId=1&problemIndex=A&ojtrace=1",
    );
    expect(tabApi.create).not.toHaveBeenCalled();
    expect(tabApi.update).not.toHaveBeenCalled();
    expect(scheduleExpiration).toHaveBeenCalledWith(7, 601_000);
    const stored = entries.get(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`);
    expect(stored?.editor?.code).toContain("bits");

    const first = await service.claim(target.targetTabId);
    expect(first).toMatchObject({
      ok: true,
      code: "submission-triggered",
    });
    expect(adapter.fill).toHaveBeenCalledOnce();
    const afterFill = entries.get(
      `${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`,
    );
    expect(afterFill?.state).toBe("observing-result");
    expect(afterFill?.editor).toBeUndefined();

    const second = await service.claim(target.targetTabId);
    expect(second).toMatchObject({
      ok: true,
      code: "submission-in-progress",
    });
    expect(storage.set).toHaveBeenCalled();
  });

  it("keeps a native submit-control click distinct from an observed form submit", async () => {
    const { service, adapter, entries } = setupService();
    adapter.fill.mockResolvedValueOnce({
      status: "submit-attempted",
      languageLabel: "GNU C++17",
    });
    const target = await service.create(cfInput);

    expect(await service.claim(target.targetTabId)).toMatchObject({
      ok: true,
      code: "submission-attempted",
      taskState: "observing-result",
    });
    expect(
      entries.get(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)?.editor,
    ).toBeUndefined();
    expect(adapter.fill).toHaveBeenCalledOnce();
  });

  it("returns the precise pre-submit safety stop without retrying", async () => {
    const { service, adapter, entries } = setupService();
    adapter.fill.mockResolvedValueOnce({
      status: "submit-blocked",
      reason: "source-mismatch",
    });
    const target = await service.create(cfInput);

    expect(await service.claim(target.targetTabId)).toMatchObject({
      ok: false,
      code: "submit-blocked-source-mismatch",
    });
    expect(entries.has(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)).toBe(
      false,
    );
    expect(adapter.fill).toHaveBeenCalledOnce();
  });

  it("serializes competing claims and rejects a mismatched target", async () => {
    const { service, tabs, adapter } = setupService();
    const target = await service.create({
      sourceTabId: 7,
      sourceUrl: "https://www.luogu.com.cn/problem/CF1A",
      problem: {
        oj: "codeforces",
        contestId: "1",
        index: "A",
        source: "luogu-pid",
      },
      editor: {
        code: "x",
        luoguLanguage: "C++17",
        editorKind: "textarea",
        capturedAt: 1,
      },
    });
    tabs.set(target.targetTabId, {
      id: target.targetTabId,
      url: "https://codeforces.com/problemset/submit?contestId=2&problemIndex=A",
    });
    const result = await service.claim(target.targetTabId);
    expect(result).toMatchObject({ ok: false, code: "target-page-changed" });
    expect(adapter.fill).not.toHaveBeenCalled();
  });

  it("marks success only after a submit event and a matching detail page", async () => {
    const { service, tabs, entries } = setupService();
    const target = await service.create({
      sourceTabId: 7,
      sourceUrl: "https://www.luogu.com.cn/problem/CF1A",
      problem: {
        oj: "codeforces",
        contestId: "1",
        index: "A",
        source: "luogu-pid",
      },
      editor: {
        code: "int main() {}",
        luoguLanguage: "C++17",
        editorKind: "textarea",
        capturedAt: 1,
      },
    });
    await service.claim(target.targetTabId);
    const submitUrl =
      "https://codeforces.com/problemset/submit?contestId=1&problemIndex=A";
    const detailUrl = "https://codeforces.com/contest/1/submission/987654";
    tabs.set(target.targetTabId, { id: target.targetTabId, url: detailUrl });
    await service.onTabUrlUpdated(target.targetTabId, detailUrl);
    expect(entries.has(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)).toBe(
      true,
    );
    const submitStarted = await service.update(target.targetTabId, detailUrl, {
      kind: "submit-observed",
      submitUrl,
    });
    expect(submitStarted).toMatchObject({
      ok: true,
      code: "observing-result",
    });

    const completed = await service.update(target.targetTabId, detailUrl, {
      kind: "result-observed",
      submissionId: "987654",
      detailUrl,
      contestId: "1",
      index: "A",
    });
    expect(completed).toMatchObject({
      ok: true,
      code: "completed",
      result: { submissionId: "987654", detailUrl },
    });
    expect(entries.has(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)).toBe(
      false,
    );
  });

  it("does not associate a different problem's detail with the task", async () => {
    const { service, tabs, entries } = setupService();
    const target = await service.create({
      sourceTabId: 7,
      sourceUrl: "https://www.luogu.com.cn/problem/CF1A",
      problem: {
        oj: "codeforces",
        contestId: "1",
        index: "A",
        source: "luogu-pid",
      },
      editor: {
        code: "int main() {}",
        luoguLanguage: "C++17",
        editorKind: "textarea",
        capturedAt: 1,
      },
    });
    await service.claim(target.targetTabId);
    const submitUrl =
      "https://codeforces.com/problemset/submit?contestId=1&problemIndex=A";
    await service.update(target.targetTabId, submitUrl, {
      kind: "submit-observed",
      submitUrl,
    });
    const detailUrl = "https://codeforces.com/contest/2/submission/987654";
    tabs.set(target.targetTabId, { id: target.targetTabId, url: detailUrl });
    const rejected = await service.update(target.targetTabId, detailUrl, {
      kind: "result-observed",
      submissionId: "987654",
      detailUrl,
      contestId: "2",
      index: "B",
    });
    expect(rejected).toMatchObject({ ok: false, code: "result-unmatched" });
    expect(
      entries.get(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)?.state,
    ).toBe("observing-result");
  });

  it("does not mark an unrelated detail page unknown before observing submit", async () => {
    const { service, tabs, entries, adapter } = setupService();
    adapter.fill.mockResolvedValueOnce({
      status: "filled",
      languageLabel: "GNU C++17",
    });
    const target = await service.create({
      sourceTabId: 7,
      sourceUrl: "https://www.luogu.com.cn/problem/CF1A",
      problem: {
        oj: "codeforces",
        contestId: "1",
        index: "A",
        source: "luogu-pid",
      },
      editor: {
        code: "int main() {}",
        luoguLanguage: "C++17",
        editorKind: "textarea",
        capturedAt: 1,
      },
    });
    await service.claim(target.targetTabId);
    const detailUrl = "https://codeforces.com/contest/1/submission/987654";
    tabs.set(target.targetTabId, { id: target.targetTabId, url: detailUrl });

    const rejected = await service.update(target.targetTabId, detailUrl, {
      kind: "result-unmatched",
    });

    expect(rejected).toMatchObject({ ok: false, code: "invalid-transition" });
    expect(
      entries.get(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)?.state,
    ).toBe("awaiting-user-submit");
  });

  it("drops an observing task when the target tab leaves the submission detail route", async () => {
    const { service, tabs, entries } = setupService();
    const target = await service.create(cfInput);
    await service.claim(target.targetTabId);
    const submitUrl = tabs.get(target.targetTabId)!.url;
    await service.update(target.targetTabId, submitUrl, {
      kind: "submit-observed",
      submitUrl,
    });
    const detailUrl = "https://codeforces.com/contest/1/submission/987654";
    tabs.set(target.targetTabId, { id: target.targetTabId, url: detailUrl });
    await service.onTabUrlUpdated(target.targetTabId, detailUrl);
    expect(entries.has(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)).toBe(
      true,
    );
    const unrelatedUrl = "https://codeforces.com/profile/tester";
    tabs.set(target.targetTabId, { id: target.targetTabId, url: unrelatedUrl });
    await service.onTabUrlUpdated(target.targetTabId, unrelatedUrl);
    expect(entries.has(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)).toBe(
      false,
    );
  });

  it("cleans up the task and TTL alarm after a correlated unknown result", async () => {
    const { service, tabs, entries, clearExpiration, getHistoryEntries } =
      setupService();
    const target = await service.create({
      sourceTabId: 7,
      sourceUrl: "https://www.luogu.com.cn/problem/CF1A",
      problem: {
        oj: "codeforces",
        contestId: "1",
        index: "A",
        source: "luogu-pid",
      },
      editor: {
        code: "int main() {}",
        luoguLanguage: "C++17",
        editorKind: "textarea",
        capturedAt: 1,
      },
    });
    await service.claim(target.targetTabId);
    const submitUrl =
      "https://codeforces.com/problemset/submit?contestId=1&problemIndex=A";
    await service.update(target.targetTabId, submitUrl, {
      kind: "submit-observed",
      submitUrl,
    });
    const detailUrl = "https://codeforces.com/contest/1/submission/987654";
    tabs.set(target.targetTabId, { id: target.targetTabId, url: detailUrl });

    const unknown = await service.update(target.targetTabId, detailUrl, {
      kind: "result-unmatched",
    });

    expect(unknown).toMatchObject({
      ok: true,
      code: "result-unknown",
      taskState: "result-unknown",
    });
    expect(entries.has(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)).toBe(
      false,
    );
    expect(clearExpiration).toHaveBeenCalledWith(target.targetTabId);
    expect(getHistoryEntries()).toEqual([]);
  });

  it("finishes as unknown on a Codeforces submission list without guessing a row", async () => {
    const { service, tabs, entries, clearExpiration, getHistoryEntries } =
      setupService();
    const target = await service.create(cfInput);
    const claimed = await service.claim(target.targetTabId);
    expect(claimed).toMatchObject({
      ok: true,
      code: "submission-triggered",
      taskState: "observing-result",
    });

    const statusUrl = "https://codeforces.com/problemset/status";
    tabs.set(target.targetTabId, { id: target.targetTabId, url: statusUrl });
    await service.onTabUrlUpdated(target.targetTabId, statusUrl);
    const unknown = await service.update(target.targetTabId, statusUrl, {
      kind: "result-unmatched",
    });

    expect(unknown).toMatchObject({
      ok: true,
      code: "result-unknown",
      taskState: "result-unknown",
      returnUrl: cfInput.sourceUrl,
    });
    expect(entries.has(`${CROSS_OJ_TASK_PREFIX}${target.targetTabId}`)).toBe(
      false,
    );
    expect(clearExpiration).toHaveBeenCalledWith(target.targetTabId);
    expect(getHistoryEntries()).toEqual([]);
  });
});
