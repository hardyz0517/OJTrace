// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const problemExportMocks = vi.hoisted(() => {
  class MockProblemExportClientError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ProblemExportClientError";
    }
  }
  return {
    inspectActiveProblemPage: vi.fn(),
    startProblemExport: vi.fn(),
    extractProblemMarkdown: vi.fn(),
    openTimeline: vi.fn(),
    openSettings: vi.fn(),
    MockProblemExportClientError,
  };
});

const crossOjMocks = vi.hoisted(() => {
  class MockCrossOjClientError extends Error {
    constructor(code: string, message: string) {
      super(message);
      this.name = "CrossOjClientError";
      void code;
    }
  }
  return {
    currentActiveTab: vi.fn(),
    enableLuoguPageIntegration: vi.fn(),
    hasCrossOjPermissions: vi.fn(),
    loadCrossOjHistory: vi.fn(),
    MockCrossOjClientError,
  };
});

vi.mock("../../src/application/problem-export/client", () => ({
  inspectActiveProblemPage: problemExportMocks.inspectActiveProblemPage,
  startProblemExport: problemExportMocks.startProblemExport,
  extractProblemMarkdown: problemExportMocks.extractProblemMarkdown,
  openTimeline: problemExportMocks.openTimeline,
  openSettings: problemExportMocks.openSettings,
  ProblemExportClientError: problemExportMocks.MockProblemExportClientError,
}));

vi.mock("../../src/oj-enhancer/features/cross-oj-submit/client", () => ({
  ...crossOjMocks,
  CrossOjClientError: crossOjMocks.MockCrossOjClientError,
}));

import { App } from "../../entrypoints/popup/main";
import { loadCrossOjHistory } from "../../src/oj-enhancer/features/cross-oj-submit/client";

const {
  inspectActiveProblemPage,
  startProblemExport,
  extractProblemMarkdown,
  openTimeline,
  openSettings,
  MockProblemExportClientError,
} = problemExportMocks;
const { loadCrossOjHistory: loadCrossOjHistoryMock } = crossOjMocks;

const tab = {
  tabId: 42,
  url: "https://www.luogu.com.cn/problem/P1001",
  title: "A+B Problem",
};
const preview = {
  oj: "luogu" as const,
  ojDisplayName: "洛谷",
  problemId: "P1001",
  title: "A+B Problem",
  originalUrl: tab.url,
};
const problemMarkdown = "# P1001 A+B Problem\n\n计算 $a+b$。\n";

let root: Root;
let container: HTMLDivElement;

class TestClipboardItem {
  constructor(private readonly items: Record<string, Blob | Promise<Blob>>) {}

  async getType(type: string): Promise<Blob> {
    const value = this.items[type];
    if (!value) throw new Error(`Missing clipboard type ${type}`);
    return await value;
  }
}

const writeText = vi.fn(async () => undefined);
const writeClipboard = vi.fn(
  async (_items: TestClipboardItem[]): Promise<void> => {},
);
const execCommand = vi.fn(() => true);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "close").mockImplementation(() => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText, write: writeClipboard },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  writeText.mockResolvedValue(undefined);
  writeClipboard.mockResolvedValue(undefined);
  execCommand.mockReturnValue(true);
  vi.stubGlobal("ClipboardItem", TestClipboardItem);
  inspectActiveProblemPage.mockResolvedValue({ tab, preview });
  extractProblemMarkdown.mockResolvedValue({ tab, markdown: problemMarkdown });
  startProblemExport.mockResolvedValue({
    tab,
    job: { token: "token", expiresAt: Date.now() + 60_000 },
  });
  openTimeline.mockResolvedValue(undefined);
  openSettings.mockResolvedValue(undefined);
  crossOjMocks.currentActiveTab.mockResolvedValue(tab);
  crossOjMocks.enableLuoguPageIntegration.mockResolvedValue(undefined);
  crossOjMocks.hasCrossOjPermissions.mockResolvedValue(false);
  loadCrossOjHistoryMock.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  container.remove();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function renderPopup(): Promise<void> {
  await act(async () => {
    root.render(createElement(App));
    await Promise.resolve();
  });
}

describe("OJTrace popup", () => {
  it("offers page integration setup without a popup submission action", async () => {
    const luoguTab = {
      tabId: 42,
      url: "https://www.luogu.com.cn/problem/CF1A",
    };
    crossOjMocks.currentActiveTab.mockResolvedValue(luoguTab);
    await renderPopup();

    expect(container.textContent).toContain("授权并启用页面入口");
    expect(container.textContent).not.toContain("提交到 Codeforces");
    expect(container.querySelector(".cross-oj-dialog")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".cross-oj-enable")!.click();
      await Promise.resolve();
    });
    expect(crossOjMocks.enableLuoguPageIntegration).toHaveBeenCalledWith({
      tabId: 42,
      url: luoguTab.url,
      target: "codeforces",
    });
  });

  it("requests AtCoder access for a Luogu ID with an original-link task ID", async () => {
    const luoguTab = {
      tabId: 42,
      url: "https://www.luogu.com.cn/problem/AT1202Contest_h#submit",
    };
    crossOjMocks.currentActiveTab.mockResolvedValue(luoguTab);
    await renderPopup();

    expect(container.textContent).toContain("授权并启用页面入口");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".cross-oj-enable")!.click();
      await Promise.resolve();
    });
    expect(crossOjMocks.enableLuoguPageIntegration).toHaveBeenCalledWith({
      tabId: 42,
      url: luoguTab.url,
      target: "atcoder",
    });
  });

  it("hides setup after both optional host permissions are granted", async () => {
    const luoguTab = {
      tabId: 42,
      url: "https://www.luogu.com.cn/problem/CF1A",
    };
    crossOjMocks.currentActiveTab.mockResolvedValue(luoguTab);
    crossOjMocks.hasCrossOjPermissions.mockResolvedValue(true);
    await renderPopup();
    await act(async () => Promise.resolve());
    expect(container.querySelector(".cross-oj-enable")).toBeNull();
    expect(container.textContent).not.toContain("提交到 Codeforces");
  });

  it("shows saved cross-OJ submission history", async () => {
    loadCrossOjHistoryMock.mockResolvedValue([
      {
        oj: "atcoder",
        submissionId: "987654",
        problemId: "abc175_f",
        detailUrl: "https://atcoder.jp/contests/abc175/submissions/987654",
        observedAt: 100,
        evaluationStatus: "judging",
        statusUpdatedAt: 100,
      },
    ]);
    await renderPopup();
    expect(container.textContent).toContain("abc175_f");
    expect(container.textContent).toContain("#987654");
    expect(container.textContent).toContain("评测中");
    expect(
      container.querySelector(".cross-oj-history a")?.getAttribute("href"),
    ).toBe("https://atcoder.jp/contests/abc175/submissions/987654");
    expect(loadCrossOjHistory).toHaveBeenCalledOnce();
  });

  it("keeps successful-download structure warnings visible without closing the popup", async () => {
    startProblemExport.mockResolvedValue({
      tab,
      job: {
        token: "warning",
        expiresAt: Date.now() + 60000,
        warnings: [{ code: "cnoi-unrecognized", message: "未知章节已保留。" }],
      },
    });
    await renderPopup();
    await act(async () =>
      container.querySelector<HTMLButtonElement>(".primary-action")!.click(),
    );
    expect(container.textContent).toContain("未知章节已保留。");
    expect(window.close).not.toHaveBeenCalled();
  });
  it("shows the current supported problem and starts an export in that tab context", async () => {
    await renderPopup();

    expect(container.querySelector(".problem-source")?.textContent).toBe(
      "洛谷",
    );
    expect(container.querySelector(".problem-id")?.textContent).toBe("P1001");
    expect(container.querySelector(".problem-title")?.textContent).toBe(
      "A+B Problem",
    );
    expect(container.querySelector("h1")).toContain(
      container.querySelector(".problem-id"),
    );
    expect(container.querySelector("h1")).toContain(
      container.querySelector(".problem-title"),
    );
    expect(container.querySelector(".popup-logo")?.getAttribute("src")).toBe(
      "/icons/ojtrace-32.png",
    );
    expect(container.querySelector(".popup-mark")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".primary-action")!.click();
      await Promise.resolve();
    });
    expect(startProblemExport).toHaveBeenCalledWith(tab, "download");
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  it("shows a compact unsupported-page state while retaining secondary entries", async () => {
    inspectActiveProblemPage.mockResolvedValue({ tab, preview: null });
    await renderPopup();

    expect(container.textContent).toContain("当前页面暂不支持题面导出");
    expect(container.querySelector(".primary-action")).toBeNull();
    expect(container.textContent).toContain("时间线");
    expect(container.textContent).toContain("设置");
  });

  it("keeps direct export busy past the page-opening timeout and closes only after download finishes", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    startProblemExport.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await renderPopup();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".primary-action")!.click();
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(startProblemExport).toHaveBeenCalledWith(tab, "download");
    expect(container.textContent).not.toContain("超时");
    expect(container.querySelector(".primary-action")?.textContent).toBe(
      "正在生成 PDF…",
    );
    expect(
      container
        .querySelector(".primary-action")
        ?.classList.contains("is-exporting"),
    ).toBe(true);
    expect(
      container
        .querySelector(".popup-action-spinner")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      container.querySelector<HTMLButtonElement>(".primary-action")?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(".export-edit-action")
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(".copy-markdown-action")
        ?.disabled,
    ).toBe(true);
    expect(window.close).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  it("opens timeline and settings through secondary launcher actions", async () => {
    inspectActiveProblemPage.mockResolvedValue({ tab, preview: null });
    await renderPopup();

    const buttons =
      container.querySelectorAll<HTMLButtonElement>(".secondary-action");
    await act(async () => {
      buttons[0]!.click();
      await Promise.resolve();
    });
    expect(openTimeline).toHaveBeenCalledTimes(1);
    expect(window.close).toHaveBeenCalledTimes(1);

    await act(async () => {
      buttons[1]!.click();
      await Promise.resolve();
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the popup open and explains when the active tab changed", async () => {
    startProblemExport.mockRejectedValue(
      new MockProblemExportClientError(
        "当前页面已发生变化，请重新识别题目后导出。",
      ),
    );
    await renderPopup();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".primary-action")!.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("当前页面已发生变化");
    expect(window.close).not.toHaveBeenCalled();
  });

  it("copies the extracted problem markdown without starting a PDF export", async () => {
    let resolveClipboard: (() => void) | undefined;
    writeClipboard.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClipboard = resolve;
        }),
    );
    await renderPopup();
    const copy = container.querySelector<HTMLButtonElement>(
      ".copy-markdown-action",
    )!;
    expect(container.querySelector(".primary-action")?.textContent).toBe(
      "直接导出 PDF",
    );
    expect(container.querySelectorAll(".primary-action")).toHaveLength(1);
    expect(container.querySelector(".export-split-toggle")).toBeNull();
    expect(copy.textContent).toBe("复制 Markdown");
    expect(container.querySelector(".problem-secondary-actions")).toContain(
      copy,
    );
    expect(container.querySelector(".problem-secondary-actions")).toContain(
      container.querySelector(".export-edit-action"),
    );

    await act(async () => {
      copy.click();
    });
    expect(copy.textContent).toBe("正在复制…");
    expect(copy.disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(".primary-action")?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(".export-edit-action")
        ?.disabled,
    ).toBe(true);
    expect(extractProblemMarkdown).toHaveBeenCalledWith(tab);
    expect(writeClipboard).toHaveBeenCalledTimes(1);

    const item = writeClipboard.mock.calls[0]?.[0]?.[0];
    if (!item) throw new Error("clipboard write was not called");
    await act(async () => {
      resolveClipboard?.();
      await item.getType("text/plain");
    });
    expect(await (await item.getType("text/plain")).text()).toBe(
      problemMarkdown,
    );
    expect(copy.textContent).toBe("已复制");
    expect(copy.classList.contains("is-copied")).toBe(true);
    expect(startProblemExport).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    expect(container.querySelector(".problem-title")?.textContent).toBe(
      "A+B Problem",
    );
  });

  it("falls back to writeText and then execCommand when async clipboard write fails", async () => {
    writeClipboard.mockRejectedValue(new Error("gesture expired"));
    writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));
    let copiedText = "";
    execCommand.mockImplementation(() => {
      copiedText = document.querySelector("textarea")!.value;
      return true;
    });
    await renderPopup();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".copy-markdown-action")!
        .click();
      await Promise.resolve();
    });
    expect(copiedText).toBe(problemMarkdown);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    expect(container.querySelector(".copy-markdown-action")?.textContent).toBe(
      "已复制",
    );
  });

  it("keeps the problem visible when clipboard writing fails", async () => {
    writeClipboard.mockRejectedValue(new Error("gesture expired"));
    writeText.mockRejectedValue(new Error("clipboard unavailable"));
    execCommand.mockReturnValue(false);
    await renderPopup();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".copy-markdown-action")!
        .click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("无法写入剪贴板，请重试。");
    expect(container.querySelector(".problem-title")?.textContent).toBe(
      "A+B Problem",
    );
    expect(
      container.querySelector<HTMLButtonElement>(".copy-markdown-action")
        ?.disabled,
    ).toBe(false);
    expect(window.close).not.toHaveBeenCalled();
  });

  it("opens the editor directly from the visible secondary action", async () => {
    await renderPopup();
    const edit = container.querySelector<HTMLButtonElement>(
      ".export-edit-action",
    )!;
    expect(edit.textContent).toBe("编辑 / 预览");
    await act(async () => {
      edit.click();
      await Promise.resolve();
    });
    expect(startProblemExport).toHaveBeenCalledWith(tab, "edit");
    expect(extractProblemMarkdown).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalledTimes(1);
  });
});
