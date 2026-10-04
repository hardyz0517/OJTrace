// @vitest-environment jsdom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/timeline/main";
import { accountRecord } from "../account-fixture";
import { defaultStoredData } from "../../src/application/storage/store";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import type { AccountSyncProgress } from "../../src/domain";
import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../../src/application/messaging/messages";

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));
const { createRoot } =
  await vi.importActual<typeof import("react-dom/client")>("react-dom/client");
const accounts = ["codeforces", "qoj"].map((source) =>
  accountRecord({
    accountId: source,
    source: source as "codeforces" | "qoj",
    providerAccountKey: "user",
    enabled: true,
    authMode: source === "codeforces" ? "public-handle" : "browser-session",
  }),
);
const data = publicStoredData({ ...defaultStoredData(), accounts });
let stateData = data;
const cf: AccountSyncProgress = {
  accountId: "codeforces",
  source: "codeforces",
  phase: "done",
  status: "complete",
  pagesFetched: 1,
  recordsFetched: 24,
};
const qoj: AccountSyncProgress = {
  accountId: "qoj",
  source: "qoj",
  phase: "list",
  status: "running",
  pagesFetched: 2,
  recordsFetched: 10,
};
let root: Root;
let container: HTMLDivElement;
type ProgressListener = (event: unknown, sender: { id?: string }) => void;
let listeners: Set<ProgressListener>;
let syncRequest: Extract<RuntimeMessage, { type: "SYNC_REQUEST" }>;
let resolve: (response: RuntimeResponse) => void;
let reject: (error: Error) => void;

beforeEach(() => {
  stateData = data;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  listeners = new Set();
  const pending = new Promise<RuntimeResponse>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  vi.stubGlobal("browser", {
    runtime: {
      id: "extension",
      getURL: (path: string) => `https://extension.test${path}`,
      onMessage: {
        addListener: (fn: ProgressListener) => listeners.add(fn),
        removeListener: (fn: ProgressListener) => listeners.delete(fn),
      },
      sendMessage: vi.fn(async (message: RuntimeMessage) => {
        if (message.type === "GET_STATE")
          return {
            schemaVersion: 2,
            requestId: message.requestId,
            ok: true,
            type: "STATE",
            data: stateData,
          };
        if (message.type !== "SYNC_REQUEST")
          throw new Error("unexpected request");
        syncRequest = message;
        // Synchronous first notification checks registration before dispatch.
        for (const fn of listeners)
          fn(
            {
              schemaVersion: 2,
              type: "SYNC_PROGRESS",
              requestId: message.requestId,
              sequence: 1,
              progress: cf,
            },
            { id: "extension" },
          );
        return pending;
      }),
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Timeline sync integration", () => {
  it("uses ordinary sync for selected Hydro accounts without an activity recheck button", async () => {
    stateData = publicStoredData({
      ...defaultStoredData(),
      accounts: [
        ...accounts,
        accountRecord({
          accountId: "hydro",
          source: "hydroj",
          origin: "https://school.example.org",
          providerAccountKey: "42",
          authMode: "browser-session",
          enabled: true,
        }),
      ],
    });
    await act(async () => root.render(createElement(App)));
    expect(
      container.querySelector('[aria-label="完整复查 Hydro 活动"]'),
    ).toBeNull();
    const button = container.querySelector<HTMLButtonElement>(".sync-button")!;
    await act(async () => button.click());
    expect(syncRequest.recheckActivities).toBeUndefined();
    expect(syncRequest.accountIds).toEqual(["codeforces", "qoj", "hydro"]);
    expect(button.disabled).toBe(true);
    await act(async () =>
      resolve({
        schemaVersion: 2,
        requestId: syncRequest.requestId,
        ok: true,
        type: "SYNC_RESULT",
        result: { data: stateData, sources: [], progress: [], addedRecords: 0 },
      }),
    );
    expect(button.disabled).toBe(false);
  });
  it("places live account progress after the toolbar and retains expandable partial results", async () => {
    await act(async () => root.render(createElement(App)));
    expect(container.querySelector(".sync-progress")).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".sync-button")!.click(),
    );
    expect(syncRequest.accountIds).toEqual(["codeforces", "qoj"]);
    expect(syncRequest.until).toBeLessThanOrEqual(Date.now());
    const bar = container.querySelector(".sync-progress")!;
    expect(bar.previousElementSibling?.classList.contains("filters")).toBe(
      true,
    );
    expect(bar.closest(".filter-actions")).toBeNull();
    expect(bar.textContent).toContain("1 / 2 个账号已完成 · 已获取 24 条记录");
    await act(async () => {
      for (const fn of listeners)
        fn(
          {
            schemaVersion: 2,
            type: "SYNC_PROGRESS",
            requestId: syncRequest.requestId,
            sequence: 2,
            progress: qoj,
          },
          { id: "extension" },
        );
    });
    expect(bar.textContent).toContain("已获取 34 条记录");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(".sync-progress-toggle")!
        .click(),
    );
    expect(bar.textContent).toContain("已扫描 2 页 · 继续查找中");
    await act(async () =>
      resolve({
        schemaVersion: 2,
        requestId: syncRequest.requestId,
        ok: true,
        type: "SYNC_RESULT",
        result: {
          data,
          sources: [],
          addedRecords: 3,
          progress: [
            cf,
            {
              ...qoj,
              phase: "done",
              status: "partial",
              reasons: ["unavailable"],
            },
          ],
        },
      }),
    );
    expect(bar.textContent).toContain("同步完成 · 1 个账号未完整同步");
    expect(bar.textContent).toContain("部分页面暂时不可读");
    expect(listeners.size).toBe(0);
    expect(
      container.querySelector<HTMLButtonElement>(".sync-button")!.disabled,
    ).toBe(false);
    expect(container.querySelector(".notice")).toBeNull();
  });

  it("shows connection interruption in the bar and removes the progress listener", async () => {
    await act(async () => root.render(createElement(App)));
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".sync-button")!.click(),
    );
    await act(async () => reject(new Error("后台连接中断")));
    expect(container.querySelector(".sync-progress")?.textContent).toContain(
      "同步中断",
    );
    expect(container.textContent).not.toContain("同步完成 · 新增");
    expect(listeners.size).toBe(0);
  });
});
