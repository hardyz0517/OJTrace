// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  LUOGU_ACCEPTED_STATUS_COLOR,
  LUOGU_UNACCEPTED_STATUS_COLOR,
  LuoguProblemHistoryStatusController,
  observeLuoguProblemHistoryChanges,
  renderLuoguProblemHistoryStatus,
} from "../../src/oj-enhancer/features/cross-oj-submit/luogu-problem-history";

function addHistoryRow(): HTMLElement {
  document.body.innerHTML = `
    <div class="l-flex-info-row">
      <span>历史分数</span>
      <a href="/record/list?pid=CF1A&amp;user=981551"><span>暂无</span></a>
    </div>`;
  return document.querySelector(".l-flex-info-row")!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Luogu Codeforces history status", () => {
  it("updates the native history value without replacing its link", () => {
    const row = addHistoryRow();
    const link = row.querySelector("a")!;

    expect(renderLuoguProblemHistoryStatus({ status: "accepted" })).toBe(true);
    expect(link.textContent).toBe("Accepted");
    expect(LUOGU_ACCEPTED_STATUS_COLOR).toBe("#52c41a");
    expect(link.querySelector("span")?.style.color).toBe("rgb(82, 196, 26)");
    expect(link.getAttribute("href")).toBe("/record/list?pid=CF1A&user=981551");

    renderLuoguProblemHistoryStatus({
      status: "unaccepted",
      message: "查询受限",
    });
    expect(link.textContent).toBe("Unaccepted");
    expect(LUOGU_UNACCEPTED_STATUS_COLOR).toBe("#e74c3c");
    expect(link.querySelector("span")?.style.color).toBe("rgb(231, 76, 60)");
    expect(link.querySelector("span")?.title).toBe("查询受限");

    renderLuoguProblemHistoryStatus(undefined);
    expect(link.textContent).toBe("暂无");
    expect(link.querySelector("span")?.style.color).toBe("");
    expect(link.querySelector("span")?.title).toBe("");
  });

  it("re-renders when Luogu replaces the history row", async () => {
    addHistoryRow();
    const onChange = vi.fn();
    const observer = observeLuoguProblemHistoryChanges(onChange);

    document.body.innerHTML = `
      <div class="l-flex-info-row">
        <span>历史分数</span><a><span>暂无</span></a>
      </div>`;
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onChange).toHaveBeenCalledTimes(1);
    observer.disconnect();
  });

  it("requests once per route, refreshes after reopening, and ignores stale replies", async () => {
    const rendered: Array<{ status: string; message?: string } | undefined> =
      [];
    const controller = new LuoguProblemHistoryStatusController((status) => {
      rendered.push(status);
    });
    const firstA = deferred<{
      status: "accepted" | "unaccepted";
    }>();
    const routeB = deferred<{ status: "accepted" | "unaccepted" }>();
    const reopenedA = deferred<{ status: "accepted" | "unaccepted" }>();
    const requestA1 = vi.fn(() => firstA.promise);
    const requestB = vi.fn(() => routeB.promise);
    const requestA2 = vi.fn(() => reopenedA.promise);

    controller.sync("CF1A", requestA1);
    controller.sync("CF1A", requestA1);
    controller.sync("CF1B", requestB);
    controller.sync(undefined);
    controller.sync("CF1A", requestA2);

    expect(requestA1).toHaveBeenCalledTimes(1);
    expect(requestB).toHaveBeenCalledTimes(1);
    expect(requestA2).toHaveBeenCalledTimes(1);

    reopenedA.resolve({ status: "accepted" });
    await reopenedA.promise;
    await Promise.resolve();
    expect(rendered.at(-1)).toEqual({ status: "accepted" });

    firstA.resolve({ status: "unaccepted" });
    routeB.resolve({ status: "unaccepted" });
    await Promise.all([firstA.promise, routeB.promise]);
    await Promise.resolve();
    expect(rendered.at(-1)).toEqual({ status: "accepted" });
  });

  it("distinguishes unavailable queries from an empty history", () => {
    const row = addHistoryRow();
    renderLuoguProblemHistoryStatus({
      status: "unavailable",
      message: "Codeforces 查询失败",
    });

    expect(row.querySelector("a")?.textContent).toBe("无法查询");
    expect(row.querySelector("a span")?.getAttribute("title")).toBe(
      "Codeforces 查询失败",
    );
  });

  it("shows a loading label until the current route query finishes", () => {
    const row = addHistoryRow();
    const controller = new LuoguProblemHistoryStatusController((status) => {
      renderLuoguProblemHistoryStatus(status);
    });
    controller.sync("CF1A", () => new Promise(() => undefined));

    expect(row.querySelector("a")?.textContent).toBe("查询中…");
    expect(row.querySelector("a span")?.getAttribute("title")).toBe(
      "正在查询 Codeforces 提交记录…",
    );
  });
});
