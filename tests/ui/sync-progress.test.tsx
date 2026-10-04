// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncProgressBar } from "../../entrypoints/timeline/SyncProgressBar";
import {
  useSyncProgress,
  type SyncRunProgress,
} from "../../entrypoints/timeline/useSyncProgress";
import type { AccountSyncProgress } from "../../src/domain";
import type { SyncProgressEvent } from "../../src/application/messaging/messages";
import { accountRecord } from "../account-fixture";

const sources = ["codeforces", "luogu", "qoj", "hydroj", "atcoder"] as const;
const accounts = sources.map((source) =>
  accountRecord({
    accountId: source,
    source,
    providerAccountKey: "user",
    providerDisplayName: "user",
    ...(source === "hydroj" ? { origin: "https://oj.example.org" } : {}),
    enabled: true,
    authMode: source === "codeforces" ? "public-handle" : "browser-session",
  }),
);
function progress(
  index: number,
  update: Partial<AccountSyncProgress> = {},
): AccountSyncProgress {
  return {
    accountId: sources[index]!,
    source: sources[index]!,
    status: "running",
    phase: "list",
    pagesFetched: 0,
    recordsFetched: 0,
    ...update,
  };
}
function fixture(): SyncRunProgress {
  return {
    requestId: "run-1",
    running: true,
    accountConfigs: accounts,
    addedRecords: 0,
    accounts: [
      progress(0, {
        status: "complete",
        phase: "done",
        pagesFetched: 1,
        recordsFetched: 24,
      }),
      progress(1, { pagesFetched: 3, pageEstimate: 8, recordsFetched: 20 }),
      progress(2, { pagesFetched: 2, recordsFetched: 10 }),
      progress(3, {
        phase: "activities",
        activitiesCompleted: 5,
        activitiesTotal: 12,
        recordsFetched: 14,
      }),
      progress(4, {
        phase: "details",
        detailsCompleted: 18,
        detailsTotal: 42,
        recordsFetched: 18,
      }),
    ],
  };
}
let root: Root;
let container: HTMLDivElement;
let listeners: Set<(event: unknown, sender: { id?: string }) => void>;
const dismiss = vi.fn();
let controls: ReturnType<typeof useSyncProgress>;

function Harness() {
  controls = useSyncProgress();
  return (
    controls.run &&
    createElement(SyncProgressBar, {
      key: controls.run.requestId,
      run: controls.run,
      onDismiss: controls.dismiss,
      renderAccount: (account) => account.source,
    })
  );
}
async function mount(run: SyncRunProgress) {
  await act(async () =>
    root.render(
      createElement(SyncProgressBar, {
        key: run.requestId,
        run,
        onDismiss: dismiss,
        renderAccount: (account) => account.source,
      }),
    ),
  );
}
async function expand() {
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(".sync-progress-toggle")!
      .click(),
  );
}
async function emit(
  requestId: string,
  sequence: number,
  account: AccountSyncProgress,
  senderId = "extension",
) {
  const event: SyncProgressEvent = {
    schemaVersion: 2,
    type: "SYNC_PROGRESS",
    requestId,
    sequence,
    progress: account,
  };
  await act(async () => {
    for (const listener of listeners) listener(event, { id: senderId });
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  listeners = new Set();
  vi.stubGlobal("browser", {
    runtime: {
      id: "extension",
      onMessage: {
        addListener: vi.fn((listener) => listeners.add(listener)),
        removeListener: vi.fn((listener) => listeners.delete(listener)),
      },
    },
  });
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("inline sync progress", () => {
  it("distinguishes unverified coverage from confirmed incomplete collection", async () => {
    const run = fixture();
    run.running = false;
    run.accounts = run.accounts.map((account) => ({
      ...account,
      status: "complete",
      phase: "done",
    }));
    run.accounts[4] = {
      ...run.accounts[4]!,
      status: "partial",
      reasons: ["unverified-coverage"],
      recordsFetched: 3,
    };
    await mount(run);
    await expand();
    expect(container.textContent).toContain("完整性未验证 · 3 条");
    expect(container.textContent).toContain("时间游标无法继续");
    expect(container.textContent).not.toContain("重试以补齐");
  });
  it("expands in place with exact stage values, estimates and unknown totals", async () => {
    await mount(fixture());
    expect(container.textContent).toContain(
      "1 / 5 个账号已完成 · 已获取 86 条记录",
    );
    const details = container.querySelector<HTMLElement>(
      ".sync-progress-details",
    )!;
    expect(details.hidden).toBe(true);
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    await expand();
    expect(details.hidden).toBe(false);
    expect(
      container.querySelector("button")?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(details.textContent).toContain("第 3 页 · 预计约 8 页");
    expect(details.textContent).toContain("已扫描 2 页 · 继续查找中");
    expect(details.textContent).toContain("已完成 5 / 12 个活动");
    expect(details.textContent).toContain("详情 18 / 42");
    const bars = details.querySelectorAll('[role="progressbar"]');
    expect(bars).toHaveLength(4);
    expect(bars[0]?.hasAttribute("aria-valuenow")).toBe(false);
    expect(bars[1]?.hasAttribute("aria-valuenow")).toBe(false);
    expect(bars[2]?.getAttribute("aria-valuenow")).toBe("5");
    expect(bars[2]?.getAttribute("aria-valuemax")).toBe("12");
    expect(bars[3]?.getAttribute("aria-valuenow")).toBe("18");
    expect(container.textContent).not.toContain("%");
    await expand();
    expect(details.hidden).toBe(true);
  });

  it("auto hides complete success, pauses while expanded, and never hides incomplete results", async () => {
    const run = fixture();
    run.running = false;
    run.addedRecords = 13;
    run.accounts = run.accounts.map((account) => ({
      ...account,
      status: "complete",
      phase: "done",
    }));
    await mount(run);
    expect(container.textContent).toContain("同步完成 · 新增 13 条记录");
    await expand();
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(dismiss).not.toHaveBeenCalled();
    await expand();
    await act(async () => vi.advanceTimersByTime(3_500));
    expect(dismiss).toHaveBeenCalledWith("run-1");
    dismiss.mockClear();
    const partial = {
      ...run,
      requestId: "run-2",
      accounts: [
        {
          ...run.accounts[0]!,
          status: "partial" as const,
          reasons: ["rate-limited" as const],
        },
        ...run.accounts.slice(1),
      ],
    };
    await mount(partial);
    expect(container.textContent).toContain("同步完成 · 1 个账号未完整同步");
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(dismiss).not.toHaveBeenCalled();
    await expand();
    expect(container.querySelector(".sync-progress-reasons")?.textContent).toBe(
      "站点限流",
    );
  });

  it("listens before sending, ignores old and reordered events, and uses the committed result", async () => {
    await act(async () => root.render(createElement(Harness)));
    let requestId = "";
    await act(async () => {
      requestId = controls.start(accounts);
    });
    expect(listeners.size).toBe(1);
    await emit(
      requestId,
      2,
      progress(1, { recordsFetched: 20, pagesFetched: 3 }),
    );
    await emit(
      requestId,
      1,
      progress(1, { recordsFetched: 10, pagesFetched: 2 }),
    );
    await emit("old-run", 99, progress(1, { recordsFetched: 999 }));
    await emit(
      requestId,
      100,
      progress(1, { recordsFetched: 999 }),
      "other-extension",
    );
    expect(controls.run?.accounts[1]?.recordsFetched).toBe(20);
    await emit(
      requestId,
      3,
      progress(0, { status: "complete", phase: "done" }),
    );
    await act(async () =>
      controls.finish(requestId, {
        addedRecords: 7,
        progress: accounts.map((_, index) =>
          progress(index, {
            status: index === 0 ? "cancelled" : "complete",
            phase: "done",
          }),
        ),
      }),
    );
    expect(listeners.size).toBe(0);
    expect(controls.run?.accounts[0]?.status).toBe("cancelled");
    expect(container.textContent).toContain("1 个账号未完整同步");
    await emit(requestId, 999, progress(0, { status: "complete" }));
    expect(controls.run?.accounts[0]?.status).toBe("cancelled");
  });

  it("cleans listeners and timers between runs, and retains interruptions without claiming success", async () => {
    await act(async () => root.render(createElement(Harness)));
    let first = "";
    await act(async () => {
      first = controls.start(accounts);
    });
    await act(async () =>
      controls.finish(first, {
        addedRecords: 7,
        progress: accounts.map((_, index) =>
          progress(index, { status: "complete", phase: "done" }),
        ),
      }),
    );
    let second = "";
    await act(async () => {
      second = controls.start(accounts);
    });
    await act(async () => vi.advanceTimersByTime(4_000));
    expect(controls.run?.requestId).toBe(second);
    expect(controls.run?.running).toBe(true);
    await emit(second, 1, progress(0, { status: "complete", phase: "done" }));
    await act(async () => controls.fail(second, "后台连接中断，请重试。"));
    expect(listeners.size).toBe(0);
    expect(container.textContent).toContain("同步中断 · 5 个账号未完整同步");
    expect(container.textContent).not.toContain("新增");
    await expand();
    expect(container.textContent).toContain("后台连接中断，请重试。");
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(controls.run).not.toBeNull();
  });
});
