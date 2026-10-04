// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncDiagnostics } from "../../entrypoints/shared/SyncDiagnostics";

describe("sync coverage UI", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps cached historical exclusions informational without flagging the account", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const element = document.createElement("div");
    const root = createRoot(element);
    await act(async () =>
      root.render(
        createElement(SyncDiagnostics, {
          data: null,
          sources: [
            {
              accountId: "hydro",
              source: "hydroj",
              diagnostics: [
                {
                  source: "hydroj",
                  code: "activity-old",
                  severity: "info",
                  messageKey: "source.activityCachedOutsideWindow",
                  retryable: false,
                  context: {
                    activityId: "old",
                    activityName: "Old homework",
                    status: "cached-outside-window",
                  },
                },
              ],
              coverage: {
                window: { since: 0, until: 10 },
                pagesFetched: 2,
                acceptedRecords: 0,
                outcome: { status: "complete", evidence: "all-streams" },
              },
            },
          ],
        }),
      ),
    );
    expect(element.querySelector("summary")?.textContent).toBe(
      "本次同步 · 活动详情 · 1 个活动",
    );
    expect(element.textContent).toContain("已跳过范围外历史活动");
    expect(element.textContent).not.toContain("未完整同步");
    expect(element.textContent).not.toContain("未实时复查");
    expect(element.querySelector(".diagnostic-warning")).toBeNull();
    expect(element.querySelector(".sync-diagnostics-note")).toBeNull();
    await act(async () => root.unmount());
  });
  it("shows partial coverage with records, missing coverage, and explained skips", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const element = document.createElement("div");
    const root = createRoot(element);
    await act(async () =>
      root.render(
        createElement(SyncDiagnostics, {
          data: null,
          sources: [
            {
              accountId: "partial",
              source: "hydroj",
              diagnostics: [],
              coverage: {
                window: { since: 0, until: 10 },
                pagesFetched: 2,
                acceptedRecords: 7,
                outcome: { status: "partial", reasons: ["page-limit"] },
              },
            },
            { accountId: "legacy", source: "qoj", diagnostics: [] },
            {
              accountId: "skipped",
              source: "luogu",
              diagnostics: [],
              skipped: "freshness",
            },
          ],
        }),
      ),
    );
    expect(element.textContent).toContain("未完整同步");
    expect(element.textContent).toContain("已获取 7 条");
    expect(element.textContent).toContain("覆盖状态未知");
    expect(element.textContent).toContain("近期已尝试同步，本次跳过");
    await act(async () => root.unmount());
  });
  it("counts unverified coverage as an account notice without implying confirmed missing records or promising a retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const element = document.createElement("div");
    const root = createRoot(element);
    await act(async () =>
      root.render(
        createElement(SyncDiagnostics, {
          data: null,
          sources: [
            {
              accountId: "Hardy_Zheng",
              source: "atcoder",
              diagnostics: [],
              coverage: {
                window: { since: 0, until: 10 },
                pagesFetched: 1,
                acceptedRecords: 3,
                outcome: {
                  status: "partial",
                  reasons: ["unverified-coverage"],
                },
              },
            },
          ],
        }),
      ),
    );
    expect(element.querySelector("summary")?.textContent).toBe(
      "本次同步 · 1 个账号需要查看",
    );
    expect(element.textContent).toContain("AtCoder · Hardy_Zheng");
    expect(element.textContent).toContain("已获取 3 条 · 完整性未验证");
    expect(element.textContent).toContain("时间游标无法继续");
    expect(element.textContent).not.toContain("0 个活动");
    expect(element.textContent).not.toContain("0 项提示");
    expect(element.textContent).not.toContain("重试以补齐");
    await act(async () => root.unmount());
  });
  it("keeps the actual account failure instead of reducing it to unknown coverage", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const element = document.createElement("div");
    const root = createRoot(element);
    await act(async () =>
      root.render(
        createElement(SyncDiagnostics, {
          data: null,
          sources: [
            {
              accountId: "cf",
              source: "codeforces",
              diagnostics: [],
              error: {
                kind: "auth_required",
                source: "codeforces",
                stage: "identity",
                messageKey: "source.authRequired",
                retryable: false,
                requestId: "r",
              },
            },
          ],
        }),
      ),
    );
    expect(element.textContent).toContain("登录状态已失效");
    expect(element.textContent).not.toContain("覆盖状态未知");
    await act(async () => root.unmount());
  });
});
