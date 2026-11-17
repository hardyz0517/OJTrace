// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://codeforces.com/contest/1/submission/101"}
import { afterEach, describe, expect, it, vi } from "vitest";
import { hideCrossOjSubmitMask } from "../../src/oj-enhancer/features/cross-oj-submit/submit-mask";

afterEach(() => {
  hideCrossOjSubmitMask();
  document.body.innerHTML = "";
  document.getElementById("ojtrace-cross-oj-submit-banner")?.remove();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cross-OJ submission result destination", () => {
  it.each([
    ["codeforces", true],
    ["atcoder", true],
    ["codeforces", false],
    ["atcoder", false],
  ] as const)(
    "keeps %s on its official detail with an active task of %s",
    async (oj, crossOjFlow) => {
      vi.resetModules();
      vi.useFakeTimers();
      const detailUrl =
        oj === "codeforces"
          ? "https://codeforces.com/contest/1/submission/101"
          : "https://atcoder.jp/contests/abc175/submissions/101";
      const submitUrl =
        oj === "codeforces"
          ? "https://codeforces.com/problemset/submit?contestId=1&problemIndex=A"
          : "https://atcoder.jp/contests/abc175/submit";
      const assign = vi.fn();
      const replace = vi.fn();
      vi.stubGlobal(
        "location",
        Object.assign(new URL(detailUrl), { assign, replace }),
      );
      vi.spyOn(document, "referrer", "get").mockReturnValue(
        crossOjFlow ? submitUrl : "",
      );
      vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
      document.body.innerHTML =
        oj === "codeforces"
          ? '<a href="https://codeforces.com/contest/1/problem/A">A</a><span id="verdict-status-cell">Accepted</span>'
          : '<table class="table-bordered"><tr><th>Task</th><td><a href="https://atcoder.jp/contests/abc175/tasks/abc175_f">F</a></td></tr><tr><th>Status</th><td>AC</td></tr></table>';
      if (crossOjFlow && oj === "codeforces") {
        sessionStorage.setItem(
          "ojtrace:codeforces:cross-oj-flow",
          JSON.stringify({ startedAt: Date.now() }),
        );
      } else if (crossOjFlow) {
        sessionStorage.setItem(
          "ojtrace:atcoder:expected-problem",
          JSON.stringify({
            oj,
            contestId: "abc175",
            taskId: "abc175_f",
            startedAt: Date.now(),
          }),
        );
      }
      const sendMessage = vi.fn(
        async (message: { requestId: string; type: string }) => ({
          schemaVersion: 1,
          requestId: message.requestId,
          ok: crossOjFlow,
          code: !crossOjFlow
            ? "task-not-found"
            : message.type === "UPDATE_CROSS_OJ_EVALUATION"
              ? "evaluation-updated"
              : "completed",
          returnUrl: "https://www.luogu.com.cn/problem/CF1A#submit",
        }),
      );
      vi.stubGlobal("browser", { runtime: { sendMessage } });
      let run!: () => Promise<void>;
      vi.stubGlobal(
        "defineContentScript",
        (definition: { main: () => Promise<void> }) => {
          run = definition.main;
          return definition;
        },
      );
      if (oj === "codeforces")
        await import("../../entrypoints/codeforces-cross-oj.content");
      else await import("../../entrypoints/atcoder-cross-oj.content");
      await run();
      await vi.runAllTimersAsync();

      expect(assign).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(location.href).toBe(detailUrl);
      expect(document.documentElement.style.visibility).not.toBe("hidden");
      expect(document.querySelector('[id$="-submit-mask"]')).toBeNull();
      expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual(
        crossOjFlow
          ? [
              "UPDATE_CROSS_OJ_TASK",
              "UPDATE_CROSS_OJ_TASK",
              "UPDATE_CROSS_OJ_EVALUATION",
            ]
          : ["UPDATE_CROSS_OJ_TASK", "UPDATE_CROSS_OJ_EVALUATION"],
      );
      if (!crossOjFlow)
        expect(
          document.getElementById("ojtrace-cross-oj-submit-banner"),
        ).toBeNull();
    },
  );
});
