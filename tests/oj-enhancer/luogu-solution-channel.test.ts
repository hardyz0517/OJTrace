// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE,
  observeLuoguSolutionChannelChanges,
  readLuoguSolutionChannelState,
  reconcileLuoguSolutionChannelBadge,
} from "../../src/oj-enhancer/features/solution-channel/luogu-page-entry";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mountPage(
  input: {
    problemId?: string;
    acceptSolution?: unknown;
    template?: string;
  } = {},
): void {
  const problemId = input.problemId ?? "P1000";
  const acceptSolution =
    "acceptSolution" in input ? input.acceptSolution : true;
  const template = input.template ?? "problem.show";
  document.body.innerHTML = `
    <script id="lentille-context" type="application/json">${JSON.stringify({
      template,
      data: { problem: { pid: problemId, acceptSolution } },
    })}</script>
    <aside class="l-card">
      <h3>标签</h3>
      <div class="tags">
        <a href="/problem/list?tag=2" data-native-link="true">
          <span class="native-luogu-tag" style="background-color: rgb(41, 78, 181)">字符串</span>
        </a>
      </div>
    </aside>`;
}

describe("Luogu solution submission channel badge", () => {
  it("reads the exact boolean from matching Luogu problem context", () => {
    mountPage();
    expect(readLuoguSolutionChannelState(document, "/problem/P1000")).toBe(
      true,
    );

    mountPage({ acceptSolution: false });
    expect(readLuoguSolutionChannelState(document, "/problem/P1000")).toBe(
      false,
    );
  });

  it("does not infer openness from text, missing fields, or mismatched pages", () => {
    mountPage({ acceptSolution: "true" });
    expect(readLuoguSolutionChannelState(document, "/problem/P1000")).toBe(
      undefined,
    );

    mountPage({ problemId: "P1001" });
    expect(readLuoguSolutionChannelState(document, "/problem/P1000")).toBe(
      undefined,
    );

    mountPage({ template: "problem.list" });
    expect(readLuoguSolutionChannelState(document, "/problem/P1000")).toBe(
      undefined,
    );
    expect(readLuoguSolutionChannelState(document, "/problem/list")).toBe(
      undefined,
    );
  });

  it("uses a fixed orange-yellow color with Luogu's native tag appearance", () => {
    mountPage();
    reconcileLuoguSolutionChannelBadge(document, "/problem/P1000");

    const badge = document.querySelector<HTMLElement>(
      `[${LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE}]`,
    );
    expect(badge).not.toBeNull();
    expect(badge?.tagName).toBe("A");
    expect(badge?.textContent?.trim()).toBe("题解通道开放");
    expect(badge?.querySelector("span")?.className).toBe("native-luogu-tag");
    expect(badge?.querySelector("span")?.style.backgroundColor).toBe(
      "rgb(243, 156, 17)",
    );
    expect(badge?.querySelector("span")?.style.borderColor).toBe(
      "rgb(217, 139, 5)",
    );
    expect(badge?.hasAttribute("href")).toBe(false);
    expect(badge?.style.cursor).toBe("");
    expect(badge?.getAttribute("role")).toBe("status");
    expect(
      document.querySelectorAll(`[${LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE}]`),
    ).toHaveLength(1);

    reconcileLuoguSolutionChannelBadge(document, "/problem/P1000");
    expect(
      document.querySelectorAll(`[${LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE}]`),
    ).toHaveLength(1);
  });

  it("removes the badge when Luogu reports that submissions are closed", () => {
    mountPage();
    reconcileLuoguSolutionChannelBadge(document, "/problem/P1000");
    mountPage({ acceptSolution: false });
    reconcileLuoguSolutionChannelBadge(document, "/problem/P1000");

    expect(
      document.querySelector(`[${LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE}]`),
    ).toBeNull();
  });

  it("adds a fallback in an empty tag card, then upgrades to native styling", () => {
    mountPage();
    const tags = document.querySelector<HTMLElement>(".tags")!;
    tags.replaceChildren();
    reconcileLuoguSolutionChannelBadge(document, "/problem/P1000");

    let badge = document.querySelector<HTMLElement>(
      `[${LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE}]`,
    );
    expect(badge?.dataset.ojtraceFallbackTag).toBe("true");
    expect(badge?.tagName).toBe("A");
    expect(badge?.hasAttribute("href")).toBe(false);
    expect(badge?.textContent?.trim()).toBe("题解通道开放");
    expect(badge?.querySelector("span")?.style.backgroundColor).toBe(
      "rgb(243, 156, 17)",
    );

    tags.insertAdjacentHTML(
      "afterbegin",
      '<a href="/problem/list?tag=2"><span class="native-luogu-tag">算法标签</span></a>',
    );
    reconcileLuoguSolutionChannelBadge(document, "/problem/P1000");
    badge = document.querySelector<HTMLElement>(
      `[${LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE}]`,
    );
    expect(badge?.dataset.ojtraceFallbackTag).toBeUndefined();
    expect(badge?.querySelector("span")?.className).toBe("native-luogu-tag");
    expect(
      tags.querySelectorAll(`[${LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE}]`),
    ).toHaveLength(1);
  });

  it("observes only the official problem context, not page or tag mutations", async () => {
    mountPage();
    const onChange = vi.fn();
    const disconnect = observeLuoguSolutionChannelChanges(
      onChange,
      document.body,
    );
    document.body.append(document.createElement("div"));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(onChange).not.toHaveBeenCalled();

    document.querySelector("#lentille-context")!.textContent = "{}";
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(onChange).toHaveBeenCalledOnce();

    onChange.mockClear();
    document.querySelector(".tags")!.append(document.createElement("span"));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onChange).not.toHaveBeenCalled();
    disconnect();
  });
});
