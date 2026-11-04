// @vitest-environment jsdom
import "./codemirror-geometry";
import {
  act,
  createElement,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversionPreviewPanel } from "../../entrypoints/settings/cnoi/ConversionPreviewPanel";
import {
  previewFixtures,
  type PreviewFixture,
} from "../../entrypoints/settings/cnoi/fixtures";
import type { SourceId } from "../../src/domain/types";
import type { CnoiRuleOverrides } from "../../src/domain/cnoi-rules";
import { isRulesMessage } from "../../src/application/cnoi-rules/messages";
import { handleRulesMessage } from "../../src/application/cnoi-rules/service";
import { createStoragePort } from "../../src/application/storage/store";
import { memoryStorageArea } from "../helpers/memory-storage";

type Input = {
  source: SourceId;
  fixture: PreviewFixture;
  draft: CnoiRuleOverrides;
  valid: boolean;
};
let update: Dispatch<SetStateAction<Input>>;
let host: HTMLDivElement, root: Root;
let storage: ReturnType<typeof createStoragePort>;
let send: ReturnType<typeof vi.fn>;
function Probe() {
  const [input, setInput] = useState<Input>({
    source: "luogu",
    fixture: previewFixtures.luogu[0]!,
    draft: {},
    valid: true,
  });
  update = setInput;
  return createElement(ConversionPreviewPanel, {
    ...input,
    onFixture: (fixture) => setInput((current) => ({ ...current, fixture })),
    onCustom: (fixture) => setInput((current) => ({ ...current, fixture })),
  });
}
const advance = async (ms = 300) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const state = () =>
  host
    .querySelector(".conversion-workbench")!
    .getAttribute("data-preview-state");
function editor(label = "Source Markdown") {
  return EditorView.findFromDOM(
    host
      .querySelector(`[aria-label="${label}"]`)!
      .closest<HTMLElement>(".cm-editor")!,
  )!;
}
const output = () => editor("CNOI Markdown").state.doc.toString();
async function source(markdown: string) {
  await act(async () => {
    const view = editor();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: markdown },
    });
  });
}
function stableEditorStructure() {
  const comparison = host.querySelector(".markdown-comparison")!;
  expect(comparison.previousElementSibling).toBe(
    host.querySelector(".comparison-options"),
  );
  expect(host.querySelector(".preview-notice")).toBeNull();
  return comparison;
}
function deferNext() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  let message: unknown;
  send.mockImplementationOnce((raw: unknown) => {
    message = raw;
    return new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
  });
  return {
    succeed: async () => {
      await act(async () => {
        if (!isRulesMessage(message))
          throw new Error("Preview was not requested");
        resolve(await handleRulesMessage(storage, message));
      });
    },
    fail: async (text: string) => {
      await act(async () => reject(new Error(text)));
    },
  };
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  storage = createStoragePort(memoryStorageArea());
  send = vi.fn(async (message: unknown) => {
    if (!isRulesMessage(message)) throw new Error("Unexpected message");
    return handleRulesMessage(storage, message);
  });
  vi.stubGlobal("browser", { runtime: { sendMessage: send } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Probe)));
  await advance();
  expect(state()).toBe("ready");
  send.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("stable CNOI live preview", () => {
  it("debounces continuous typing without inserting banners or replacing editors, retaining the last successful output", async () => {
    const comparison = stableEditorStructure(),
      view = editor(),
      last = output();
    for (const word of ["A", "AB", "ABC"]) {
      await source(`### Input\n\n${word}\n`);
      await advance(100);
      expect(stableEditorStructure()).toBe(comparison);
      expect(editor()).toBe(view);
      expect(output()).toBe(last);
      expect(state()).toBe("pending");
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(
        host
          .querySelector('.comparison-pane [aria-label="Source Markdown"]')!
          .closest(".cm-editor")!
          .querySelector('[class*="diff-line-"]'),
      ).toBeNull();
    }
    expect(send).not.toHaveBeenCalled();
    await advance(150);
    expect(send).toHaveBeenCalledTimes(1);
    expect(output()).toContain("ABC");
    expect(state()).toBe("ready");
    expect(stableEditorStructure()).toBe(comparison);
  });

  it("shows delayed progress in the existing status slot, and puts real failures and retry below the editors", async () => {
    const previous = output(),
      comparison = stableEditorStructure();
    const pending = deferNext();
    await source("## Input\n\nSlow body.\n");
    await advance(749);
    expect(state()).toBe("pending");
    await advance(1);
    expect(state()).toBe("running");
    expect(stableEditorStructure()).toBe(comparison);
    expect(output()).toBe(previous);
    await pending.fail("规则服务暂不可用");
    expect(state()).toBe("error");
    const error = host.querySelector('[role="alert"]')!;
    expect(error.textContent).toContain("已保留上次成功结果");
    expect(
      comparison.compareDocumentPosition(error) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(stableEditorStructure()).toBe(comparison);
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".preview-error button")!.click(),
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await advance();
    expect(state()).toBe("ready");
    expect(output()).toContain("Slow body.");
  });

  it("bounds a hung request, ignores its late success and lets the user retry", async () => {
    const last = output(),
      pending = deferNext();
    await source("## Input\n\nRecover after timeout.\n");
    await advance(15_250);
    expect(state()).toBe("error");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("超时");
    await pending.succeed();
    expect(output()).toBe(last);
    expect(state()).toBe("error");
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".preview-error button")!.click(),
    );
    await advance();
    expect(output()).toContain("Recover after timeout.");
    expect(state()).toBe("ready");
  });

  it("ignores valid out-of-order successes and old failures after the latest preview is ready", async () => {
    const old = deferNext();
    await source("## Unknown old section\n\nOld body.\n");
    await advance();
    const failed = deferNext();
    await source("## Input\n\nIntermediate body.\n");
    await advance();
    await source("## Input\n\nLatest body.\n");
    await advance();
    await old.succeed();
    await failed.fail("Outdated failure");
    expect(state()).toBe("ready");
    expect(output()).toContain("Latest body.");
    expect(host.textContent).not.toContain("Unknown old section");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("cancels pending previews during IME composition and converts only after composition ends", async () => {
    const last = output(),
      pending = deferNext();
    await source("## Input\n\nBefore composition.\n");
    await advance();
    await act(async () =>
      editor().contentDOM.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    await pending.succeed();
    await source("## Input\n\n中文输入\n");
    await advance(2000);
    expect(state()).toBe("composing");
    expect(send).toHaveBeenCalledTimes(1);
    expect(output()).toBe(last);
    stableEditorStructure();
    await act(async () =>
      editor().contentDOM.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    await advance();
    expect(state()).toBe("ready");
    expect(output()).toContain("中文输入");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not show another OJ's result or stay stuck composing when switching OJs", async () => {
    await source("## Input\n\nLuogu-only body.\n");
    await advance();
    await act(async () =>
      editor().contentDOM.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    await act(async () =>
      update((current) => ({
        ...current,
        source: "codeforces",
        fixture: previewFixtures.codeforces[0]!,
      })),
    );
    expect(output()).toBe("");
    expect(state()).toBe("pending");
    await advance();
    expect(state()).toBe("ready");
    expect(output()).not.toContain("Luogu-only body");
  });

  it("suspends invalid drafts and discards pending results until validation succeeds", async () => {
    const last = output(),
      pending = deferNext();
    await source("## Input\n\nValid body.\n");
    await advance();
    await act(async () => update((current) => ({ ...current, valid: false })));
    await pending.succeed();
    await advance(2000);
    expect(state()).toBe("invalid");
    expect(output()).toBe(last);
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => update((current) => ({ ...current, valid: true })));
    await advance();
    expect(state()).toBe("ready");
    expect(output()).toContain("Valid body.");
  });

  it("does not reconvert fixture labels alone or revive an old error when undo returns to a failed input", async () => {
    await act(async () =>
      update((current) => ({
        ...current,
        fixture: { ...current.fixture, id: "custom", name: "Renamed" },
        draft: { ...current.draft },
      })),
    );
    await advance();
    expect(send).not.toHaveBeenCalled();
    const failed = deferNext();
    await source("## Input\n\nFirst input.\n");
    await advance();
    await failed.fail("Previous failure");
    expect(state()).toBe("error");
    await source("## Input\n\nNew input.\n");
    await source("## Input\n\nFirst input.\n");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await advance();
    expect(state()).toBe("ready");
  });
});
