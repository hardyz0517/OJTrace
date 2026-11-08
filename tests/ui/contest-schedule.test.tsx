// @vitest-environment jsdom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeMessage } from "../../src/application/messaging/messages";
import type {
  ContestCache,
  ContestPlatform,
} from "../../src/features/contest-schedule/core/types";
import { CONTEST_DATA_VERSION } from "../../src/features/contest-schedule/core/types";

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));
const { createRoot } =
  await vi.importActual<typeof import("react-dom/client")>("react-dom/client");
const { App } = await import("../../entrypoints/contest-schedule/main");

let root: Root;
let host: HTMLDivElement;
let caches: Partial<Record<ContestPlatform, ContestCache>>;
let sendMessage: ReturnType<typeof vi.fn>;
let containsPermission: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;
let refreshResults: unknown;

function cache(
  platform: ContestPlatform,
  id: string,
  startTime: number,
): ContestCache {
  return {
    schemaVersion: 1,
    platform,
    lastSuccessAt: Date.now(),
    contestDataVersion: CONTEST_DATA_VERSION,
    contests: [
      {
        id,
        platform,
        title: `${platform} contest`,
        url:
          platform === "codeforces"
            ? `https://codeforces.com/contest/${id}`
            : platform === "atcoder"
              ? `https://atcoder.jp/contests/${id}`
              : `https://www.luogu.com.cn/contest/${id}`,
        startTime,
        durationSeconds: 3_600,
        endTime: startTime + 3_600_000,
        fetchedAt: Date.now(),
      },
    ],
  };
}

function response(
  message: RuntimeMessage,
  nextCaches = caches,
  results?: unknown,
) {
  return {
    schemaVersion: 2,
    requestId: message.requestId,
    ok: true,
    type: "CONTEST_STATE",
    caches: nextCaches,
    ...(results === undefined ? {} : { results }),
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  caches = {};
  containsPermission = vi.fn(async () => true);
  requestPermission = vi.fn(async () => true);
  refreshResults = undefined;
  sendMessage = vi.fn(async (message: RuntimeMessage) => {
    if (message.type === "CONTEST_GET_STATE") return response(message);
    if (message.type === "CONTEST_REFRESH")
      return response(message, caches, refreshResults);
    if (message.type === "CONTEST_ENRICH_COUNTS")
      return response(message, caches);
    throw new Error(`Unexpected message: ${message.type}`);
  });
  vi.stubGlobal("browser", {
    runtime: {
      getURL: (path: string) => `chrome-extension://test${path}`,
      sendMessage,
    },
    permissions: {
      contains: containsPermission,
      request: requestPermission,
    },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Contest Schedule page", () => {
  it("shows cached contests without fetching on page entry", async () => {
    caches = { luogu: cache("luogu", "1024", Date.now() + 60 * 60_000) };
    await act(async () => root.render(createElement(App)));

    expect(host.querySelector(".contest-page.shell")).not.toBeNull();
    expect(host.querySelector(".contest-heading")).toBeNull();
    expect(
      host.querySelector(".filters .animated-select--compact"),
    ).not.toBeNull();
    expect(
      host.querySelector(".contest-refresh-button.sync-button"),
    ).not.toBeNull();
    expect(host.querySelector(".source-statuses")).toBeNull();
    expect(host.textContent).toContain("上次更新");
    expect(host.textContent).toContain("luogu contest");
    expect(host.textContent).toContain("洛谷");
    expect(
      sendMessage.mock.calls.map(
        ([message]) => (message as RuntimeMessage).type,
      ),
    ).toEqual(["CONTEST_GET_STATE", "CONTEST_ENRICH_COUNTS"]);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("refreshes legacy cached source metadata once on entry", async () => {
    const legacy = cache("luogu", "1024", Date.now() + 60 * 60_000);
    delete legacy.contestDataVersion;
    caches = { luogu: legacy };
    await act(async () => root.render(createElement(App)));

    const refresh = sendMessage.mock.calls
      .map(([message]) => message as RuntimeMessage)
      .find((message) => message.type === "CONTEST_REFRESH");
    expect(refresh).toMatchObject({
      type: "CONTEST_REFRESH",
      platforms: ["luogu"],
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("renders mixed OJ sections, full local times, problem counts, and whole-row links", async () => {
    const now = Date.now();
    const running = cache("luogu", "running", now - 2 * 86_400_000);
    running.contests[0]!.durationSeconds = 5 * 86_400;
    running.contests[0]!.endTime = now + 3 * 86_400_000;
    running.contests[0]!.title = "Long running contest";
    running.contests[0]!.problemCount = 4;
    running.contests[0]!.evaluation = { rating: true, estimate: true };
    const upcoming = cache("codeforces", "2300", now + 2 * 86_400_000);
    upcoming.contests[0]!.title = "Upcoming with count";
    upcoming.contests[0]!.problemCount = 8;
    upcoming.contests[0]!.evaluation = { rating: true, estimate: false };
    const finished = cache("atcoder", "abc482", now - 86_400_000);
    finished.contests[0]!.title = "Recently finished";
    caches = { luogu: running, codeforces: upcoming, atcoder: finished };
    await act(async () => root.render(createElement(App)));

    const sections = [
      ...host.querySelectorAll<HTMLElement>(".contest-section"),
    ];
    expect(
      sections.map((section) => section.querySelector("h2")?.textContent),
    ).toEqual(["正在进行", "即将开始", "最近结束"]);
    expect(host.querySelector(".contest-day h3")?.textContent).toMatch(
      /^\d{1,2}月\d{1,2}日（星期[一二三四五六日]）$/,
    );
    const upcomingRow = host.querySelector<HTMLAnchorElement>(
      'a[href="https://codeforces.com/contest/2300"]',
    );
    expect(upcomingRow?.getAttribute("target")).toBe("_blank");
    expect(upcomingRow?.textContent).toContain("8 题");
    expect(upcomingRow?.textContent).toMatch(
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2} ~ \d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
    );
    expect(upcomingRow?.textContent).toContain("即将开始");
    const luoguRow = host.querySelector<HTMLAnchorElement>(
      'a[href="https://www.luogu.com.cn/contest/running"]',
    );
    expect(luoguRow?.textContent).toContain("4 题");
    expect(
      luoguRow
        ?.querySelector(".contest-evaluation-gold")
        ?.getAttribute("title"),
    ).toBe("参与等级分评定及估值评定");
    expect(
      upcomingRow
        ?.querySelector(".contest-evaluation-green")
        ?.getAttribute("title"),
    ).toBe("参与等级分评定");
    expect(host.querySelector(".contest-range-note")).toBeNull();
    expect(host.querySelector(".source-statuses")).toBeNull();
  });

  it("opens the shared filter menu through its animated portal", async () => {
    caches = { luogu: cache("luogu", "1024", Date.now() + 60 * 60_000) };
    await act(async () => root.render(createElement(App)));

    const trigger = host.querySelector<HTMLButtonElement>(
      '.animated-select button[aria-label="OJ 筛选"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => trigger!.click());

    const menu = document.querySelector<HTMLElement>(
      ".animated-select-portal[data-state='open']",
    );
    expect(menu).not.toBeNull();
    expect(menu?.querySelector("[role='listbox']")).not.toBeNull();
  });

  it("automatically fetches once when all platform caches are missing", async () => {
    await act(async () => root.render(createElement(App)));

    expect(
      sendMessage.mock.calls.map(
        ([message]) => (message as RuntimeMessage).type,
      ),
    ).toEqual(["CONTEST_GET_STATE", "CONTEST_REFRESH"]);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      type: "CONTEST_REFRESH",
      platforms: ["luogu", "codeforces", "atcoder"],
    });
  });

  it("retries Luogu when its cache is missing but other sources are cached", async () => {
    caches = {
      codeforces: cache("codeforces", "2300", Date.now() + 60 * 60_000),
      atcoder: cache("atcoder", "abc483", Date.now() + 60 * 60_000),
    };
    await act(async () => root.render(createElement(App)));

    expect(
      sendMessage.mock.calls.map(
        ([message]) => (message as RuntimeMessage).type,
      ),
    ).toEqual([
      "CONTEST_GET_STATE",
      "CONTEST_ENRICH_COUNTS",
      "CONTEST_REFRESH",
    ]);
    expect(sendMessage.mock.calls[2]?.[0]).toMatchObject({
      type: "CONTEST_REFRESH",
      platforms: ["luogu"],
    });
    expect(host.textContent).toContain("Codeforces");
  });

  it("requests only the already declared optional contest origins on manual refresh", async () => {
    caches = {
      luogu: {
        schemaVersion: 1,
        platform: "luogu",
        contests: [],
        lastSuccessAt: Date.now(),
        contestDataVersion: CONTEST_DATA_VERSION,
      },
    };
    await act(async () => root.render(createElement(App)));
    const button = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("刷新赛程"),
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());

    expect(requestPermission).toHaveBeenCalledWith({
      origins: [
        "https://codeforces.com/*",
        "https://atcoder.jp/*",
        "https://kenkoooo.com/*",
      ],
    });
    const refresh = sendMessage.mock.calls
      .map(([message]) => message as RuntimeMessage)
      .find((message) => message.type === "CONTEST_REFRESH");
    expect(refresh).toMatchObject({
      type: "CONTEST_REFRESH",
      platforms: ["luogu", "codeforces", "atcoder"],
    });
  });

  it("shows partial provider failures on demand while retaining cached contests", async () => {
    caches = { luogu: cache("luogu", "1024", Date.now() + 60 * 60_000) };
    refreshResults = [
      { platform: "luogu", status: "success", contestCount: 1 },
      { platform: "codeforces", status: "failed", message: "HTTP 503" },
      { platform: "atcoder", status: "success", contestCount: 1 },
    ];
    await act(async () => root.render(createElement(App)));
    const refresh = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("刷新赛程"),
    );
    await act(async () => refresh!.click());

    const summary = [
      ...host.querySelectorAll<HTMLButtonElement>("button"),
    ].find((item) => item.textContent?.includes("部分更新"));
    expect(summary).toBeDefined();
    expect(host.textContent).not.toContain("HTTP 503");
    await act(async () => summary!.click());
    expect(host.textContent).toContain("Codeforces：HTTP 503");
    expect(host.textContent).toContain("luogu contest");
  });

  it("reports total failure without clearing stale cache", async () => {
    caches = { luogu: cache("luogu", "1024", Date.now() + 60 * 60_000) };
    refreshResults = [
      { platform: "luogu", status: "failed", message: "站点不可用" },
      { platform: "codeforces", status: "failed", message: "HTTP 503" },
      { platform: "atcoder", status: "failed", message: "超时" },
    ];
    await act(async () => root.render(createElement(App)));
    const refresh = [...host.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("刷新赛程"),
    );
    await act(async () => refresh!.click());

    expect(host.textContent).toContain("本次更新失败，仍显示上次缓存。");
    expect(host.textContent).toContain("luogu contest");
  });
});
