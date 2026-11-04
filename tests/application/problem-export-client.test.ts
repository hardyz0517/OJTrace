import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractProblemMarkdown,
  inspectActiveProblemPage,
  startProblemExport,
} from "../../src/application/problem-export/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("problem export client", () => {
  it("reports the background failure instead of a format error", async () => {
    vi.stubGlobal("browser", {
      tabs: {
        query: vi.fn(async () => [
          { id: 3, url: "edge://extensions/", title: "扩展" },
        ]),
      },
      runtime: {
        sendMessage: vi.fn(async () => ({
          schemaVersion: 2,
          requestId: "req-1",
          ok: false,
          error: {
            code: "problem_export_failed",
            message: "当前页面无法读取，请切换到题目页后重试。",
          },
        })),
      },
    });

    await expect(inspectActiveProblemPage()).rejects.toMatchObject({
      name: "ProblemExportClientError",
      code: "background_error",
      message: "当前页面无法读取，请切换到题目页后重试。",
    });
  });

  it("returns markdown extracted from the active problem tab", async () => {
    const markdown = "# P1001 A+B Problem\n\n计算 $a+b$。\n";
    const sendMessage = vi.fn(async (message: { requestId: string }) => ({
      schemaVersion: 2,
      requestId: message.requestId,
      ok: true,
      type: "PROBLEM_MARKDOWN",
      markdown,
    }));
    vi.stubGlobal("browser", {
      tabs: {
        query: vi.fn(async () => [
          {
            id: 3,
            url: "https://www.luogu.com.cn/problem/P1001",
            title: "A+B Problem",
          },
        ]),
      },
      runtime: { sendMessage },
    });

    await expect(extractProblemMarkdown()).resolves.toEqual({
      tab: {
        tabId: 3,
        url: "https://www.luogu.com.cn/problem/P1001",
        title: "A+B Problem",
      },
      markdown,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "EXTRACT_PROBLEM_MARKDOWN",
        tabId: 3,
        expectedUrl: "https://www.luogu.com.cn/problem/P1001",
      }),
    );
  });

  it("sends an edit export without the statement payload", async () => {
    const sendMessage = vi.fn(async (message: { requestId: string }) => ({
      schemaVersion: 2,
      requestId: message.requestId,
      ok: true,
      type: "EXPORT_STARTED",
      job: { token: "token-token-token", expiresAt: 20 },
    }));
    vi.stubGlobal("browser", {
      tabs: {
        query: vi.fn(async () => [
          {
            id: 3,
            url: "https://www.luogu.com.cn/problem/P1001",
            title: "A+B Problem",
          },
        ]),
      },
      runtime: { sendMessage },
    });

    await startProblemExport(undefined, "edit");
    const message = sendMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(message).toMatchObject({
      type: "START_PROBLEM_EXPORT",
      intent: "edit",
      tabId: 3,
      expectedUrl: "https://www.luogu.com.cn/problem/P1001",
    });
    expect(message).not.toHaveProperty("markdown");
    expect(JSON.stringify(message)).not.toContain("%PDF");
  });
});
