// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLuoguPageAccessGate } from "../../src/oj-enhancer/features/cross-oj-submit/luogu-page-access";
import {
  findLuoguNativeSubmitButton,
  inspectLuoguNativeSubmitUi,
  insertLuoguCrossOjEntry,
  observeLuoguSubmitUiChanges,
  updateLuoguCrossOjStatus,
} from "../../src/oj-enhancer/features/cross-oj-submit/luogu-page-entry";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function makeElementsVisible(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 128,
    height: 42,
    top: 0,
    right: 128,
    bottom: 42,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("Luogu page-native cross-OJ entry", () => {
  it("retries a denied page-access check and reconciles after its pending state clears", async () => {
    vi.useFakeTimers();
    const gate = createLuoguPageAccessGate();
    const verify = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("background is waking"))
      .mockResolvedValueOnce(true);
    const key = "https://www.luogu.com.cn/problem/AT_abc001_b";
    let installed = false;
    const reconcile = () => {
      if (gate.hasAccess(key)) {
        installed = true;
        return;
      }
      gate.check(key, verify, () => true, reconcile);
    };

    reconcile();
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(250);

    expect(verify).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(750);

    expect(verify).toHaveBeenCalledTimes(3);
    expect(gate.hasAccess(key)).toBe(true);
    expect(installed).toBe(true);
    gate.dispose();
  });

  it("places a non-submit button immediately after Luogu's submit button", () => {
    makeElementsVisible();
    document.body.innerHTML = `
      <form><button type="submit" class="lg-btn lg-btn-blue" data-v-505b6a97="" data-v-58f9699c="" style="margin-top: 1em">提交评测</button></form>`;
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submit);
    const native = findLuoguNativeSubmitButton();
    expect(native?.textContent).toBe("提交评测");
    if (!native) throw new Error("native submit button was not found");
    expect(native.type).toBe("submit");

    const onActivate = vi.fn();
    const entry = insertLuoguCrossOjEntry(
      native,
      {
        oj: "codeforces",
        contestId: "1",
        index: "A",
        source: "luogu-pid",
      },
      onActivate,
    );

    expect(entry.type).toBe("button");
    expect(entry.textContent).toBe("提交到 Codeforces");
    expect(entry.className).toBe(native.className);
    expect(entry.getAttribute("data-v-505b6a97")).toBe("");
    expect(entry.getAttribute("data-v-58f9699c")).toBe("");
    expect(entry.previousElementSibling).toBe(native);
    expect(entry.style.marginLeft).toBe("8px");
    expect(entry.style.display).toBe(getComputedStyle(native).display);
    expect(entry.style.verticalAlign).toBe(
      getComputedStyle(native).verticalAlign,
    );
    expect(entry.style.marginTop).toBe(getComputedStyle(native).marginTop);
    // Keep the site's class-driven hover rules active. Inline snapshots of
    // computed appearance would override selectors such as .lg-btn-blue:hover.
    expect(entry.style.background).toBe("");
    expect(entry.style.color).toBe("");
    expect(entry.style.border).toBe("");
    expect(entry.style.font).toBe("");
    entry.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(entry, expect.any(MouseEvent));
    expect(submit).not.toHaveBeenCalled();
  });

  it("matches the native button's rendered top edge and border-box height", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const top = this.id === "ojtrace-cross-oj-submit-entry" ? 90 : 100;
        const height = this.id === "ojtrace-cross-oj-submit-entry" ? 36 : 46;
        return {
          width: 128,
          height,
          top,
          right: 202,
          bottom: top + height,
          left: 74,
          x: 74,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    document.body.innerHTML = `
      <form><button type="submit" class="lg-btn lg-btn-blue">提交评测</button></form>`;
    const native = findLuoguNativeSubmitButton();
    if (!native) throw new Error("native submit button was not found");

    const entry = insertLuoguCrossOjEntry(
      native,
      {
        oj: "codeforces",
        contestId: "1",
        index: "A",
        source: "luogu-pid",
      },
      vi.fn(),
    );

    expect(entry.style.height).toBe("46px");
    expect(entry.style.boxSizing).toBe("border-box");
    expect(entry.style.position).toBe("relative");
    expect(entry.style.top).toBe("10px");
  });

  it("does not guess when multiple visible native submit controls exist", () => {
    makeElementsVisible();
    document.body.innerHTML = `
      <button>提交评测</button>
      <button>提交评测</button>`;
    expect(findLuoguNativeSubmitButton()).toBeUndefined();
  });

  it("reports hidden and duplicate native submit candidates for diagnosis", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const hidden = this.closest(".collapsed") !== null;
        const width = hidden ? 0 : 128;
        const height = hidden ? 0 : 42;
        return {
          width,
          height,
          top: 0,
          right: width,
          bottom: height,
          left: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
    document.body.innerHTML = `
      <section class="collapsed"><button>提交评测</button></section>
      <button>提交评测</button>
      <button>提交评测</button>`;

    expect(inspectLuoguNativeSubmitUi()).toMatchObject({
      fileUploaderVisible: false,
      candidateCount: 3,
      visibleCandidateCount: 2,
      candidateSizes: [
        { width: 0, height: 0 },
        { width: 128, height: 42 },
        { width: 128, height: 42 },
      ],
    });
  });

  it("does not add the entry while the file-upload tab is visible", () => {
    makeElementsVisible();
    document.body.innerHTML = `
      <div class="drop">选择文件</div>
      <button type="submit">提交评测</button>`;
    expect(findLuoguNativeSubmitButton()).toBeUndefined();
  });

  it("reconciles when the lazy submit panel is revealed with class or style", async () => {
    document.body.innerHTML = `
      <section class="submit-panel" style="display:none">
        <button type="submit">提交评测</button>
      </section>`;
    const panel = document.querySelector<HTMLElement>(".submit-panel")!;
    const onChange = vi.fn();
    const observer = observeLuoguSubmitUiChanges(onChange, document.body);

    panel.classList.add("active");
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onChange).toHaveBeenCalledTimes(1);
    observer.disconnect();
  });

  it("starts observing before the page's html root exists", async () => {
    document.documentElement?.remove();
    const onChange = vi.fn();
    const observer = observeLuoguSubmitUiChanges(onChange);

    const html = document.createElement("html");
    html.innerHTML = `<body><button>提交评测</button></body>`;
    document.append(html);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onChange).toHaveBeenCalledTimes(1);
    observer.disconnect();
  });

  it("reconciles when a native button becomes measurable without another DOM mutation", () => {
    document.body.innerHTML = `<button>提交评测</button>`;
    const button = document.querySelector("button")!;
    const onChange = vi.fn();
    const disconnect = vi.fn();
    let triggerResize: (() => void) | undefined;

    vi.stubGlobal(
      "ResizeObserver",
      class MockResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          triggerResize = () =>
            callback(
              [
                {
                  target: button,
                  contentRect: { width: 128, height: 42 },
                } as unknown as ResizeObserverEntry,
              ],
              this as unknown as ResizeObserver,
            );
        }

        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = disconnect;
      },
    );

    const observer = observeLuoguSubmitUiChanges(onChange);
    expect(onChange).not.toHaveBeenCalled();

    triggerResize?.();

    expect(onChange).toHaveBeenCalledTimes(1);
    observer.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("reconciles when Luogu replaces problem metadata during SPA navigation", async () => {
    document.body.innerHTML = `
      <script id="lentille-context" type="application/json">{"data":{"problem":{"pid":"CF1A"}}}</script>`;
    const context = document.querySelector("#lentille-context")!;
    const onChange = vi.fn();
    const observer = observeLuoguSubmitUiChanges(onChange, document.body);

    context.textContent = '{"data":{"problem":{"pid":"AT_abc001_b"}}}';
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onChange).toHaveBeenCalledTimes(1);
    observer.disconnect();
  });

  it("reconciles when the page context is inserted after the content script starts", async () => {
    document.body.innerHTML = "<main></main>";
    const onChange = vi.fn();
    const observer = observeLuoguSubmitUiChanges(onChange, document.body);

    document.body.insertAdjacentHTML(
      "afterbegin",
      '<script id="lentille-context" type="application/json">{"data":{"problem":{"pid":"CF1A"}}}</script>',
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onChange).toHaveBeenCalledTimes(1);
    observer.disconnect();
  });

  it("ignores editor mutations unrelated to the native submit control", async () => {
    document.body.innerHTML = `
      <section class="submit-panel"><button>提交评测</button></section>
      <div class="editor"><span>code</span></div>`;
    const editor = document.querySelector<HTMLElement>(".editor")!;
    const onChange = vi.fn();
    const observer = observeLuoguSubmitUiChanges(onChange, document.body);

    editor.classList.add("focused");
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onChange).not.toHaveBeenCalled();
    document.body.append(document.createElement("div"));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(onChange).not.toHaveBeenCalled();
    observer.disconnect();
  });

  it("updates one reusable status row instead of stacking errors", () => {
    makeElementsVisible();
    document.body.replaceChildren();
    const first = updateLuoguCrossOjStatus("无法读取编辑器");
    const second = updateLuoguCrossOjStatus("仍无法读取编辑器");

    expect(second).toBe(first);
    expect(second.textContent).toBe("仍无法读取编辑器");
    expect(
      document.querySelectorAll('[data-ojtrace-cross-oj-status="true"]'),
    ).toHaveLength(1);
    expect(second.style.position).toBe("fixed");
  });
});
