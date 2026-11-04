// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://codeforces.com/problemset/submit?contestId=1&problemIndex=A"}

import { describe, expect, it, vi } from "vitest";
import {
  fillCodeforcesFormInPage,
  inspectCodeforcesFormInPage,
} from "../../src/oj-enhancer/features/cross-oj-submit/codeforces-page";

function addSubmitFixture(
  code = "",
  options: { withCodeMirror?: boolean } = { withCodeMirror: true },
  dispatchSubmit = true,
): void {
  document.body.innerHTML = `
    <header><a href="/profile/tester">tester</a></header>
    <form id="submitForm" action="/problemset/submit">
      <input type="hidden" name="action" value="submitSolutionFormSubmitted">
      <select id="programTypeId" name="programTypeId">
        <option value="">Choose language</option>
        <option value="54">GNU C++17</option>
        <option value="61">GNU C++20 (64)</option>
      </select>
      <textarea id="sourceCodeTextarea" name="source"></textarea>
      <button type="submit" class="submit">Submit</button>
      <div class="submit" aria-hidden="true"></div>
    </form>`;
  const form = document.querySelector<HTMLFormElement>("form")!;
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
  textarea.value = code;
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  Object.defineProperty(submit, "click", {
    value: vi.fn(() =>
      dispatchSubmit
        ? form.dispatchEvent(
            new SubmitEvent("submit", { bubbles: true, cancelable: true }),
          )
        : undefined,
    ),
  });
  if (options.withCodeMirror) {
    const wrapper = document.createElement("div");
    wrapper.className = "CodeMirror";
    form.insertBefore(wrapper, submit);
    const state = { value: code };
    Object.assign(textarea, {
      CodeMirror: {
        getValue: () => state.value,
        setValue: (value: string) => {
          state.value = value;
        },
        getWrapperElement: () => wrapper,
        save: () => {
          textarea.value = state.value;
        },
      },
    });
  }
}

function args(submit = false) {
  return {
    problem: {
      oj: "codeforces" as const,
      contestId: "1",
      index: "A",
      source: "luogu-pid" as const,
    },
    code: "#include <bits/stdc++.h>\nint main() {}",
    languageValue: "54",
    submit,
  };
}

describe("Codeforces submit page adapter", () => {
  it("reads current language options and fills an empty native form", async () => {
    addSubmitFixture();
    expect(inspectCodeforcesFormInPage()).toMatchObject({
      status: "ready",
      codePresent: false,
    });
    expect(await fillCodeforcesFormInPage(args())).toMatchObject({
      status: "filled",
    });
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      args().code,
    );
  });

  it("submits through the native form after verifying the complete code", async () => {
    addSubmitFixture();
    const submit = vi.fn();
    document.querySelector("form")!.addEventListener("submit", submit);
    expect(await fillCodeforcesFormInPage(args(true))).toMatchObject({
      status: "submit-triggered",
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLButtonElement>("button[type=submit]")?.click,
    ).toHaveBeenCalledOnce();
  });

  it("treats a Codeforces native submit event as an attempt even when handled by the page", async () => {
    addSubmitFixture();
    document
      .querySelector("form")!
      .addEventListener("submit", (event) => event.preventDefault());
    expect(await fillCodeforcesFormInPage(args(true))).toMatchObject({
      status: "submit-triggered",
    });
  });

  it("reports a native control click without a submit event as only an attempt", async () => {
    addSubmitFixture("", { withCodeMirror: true }, false);
    const submitter = document.querySelector<HTMLButtonElement>(
      "button[type=submit]",
    )!;

    expect(await fillCodeforcesFormInPage(args(true))).toMatchObject({
      status: "submit-attempted",
    });
    expect(submitter.click).toHaveBeenCalledOnce();
  });

  it("uses the CodeMirror instance attached to its hidden textarea", async () => {
    addSubmitFixture("", { withCodeMirror: false });
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const wrapper = document.createElement("div");
    wrapper.className = "CodeMirror";
    document.querySelector("form")!.append(wrapper);
    const state = { value: "" };
    const editor = {
      getValue: () => state.value,
      setValue: (value: string) => {
        state.value = value;
      },
      getWrapperElement: () => wrapper,
      save: () => {
        textarea.value = state.value;
      },
    };
    Object.assign(textarea, { CodeMirror: editor });
    document.querySelector("form")!.addEventListener("submit", () => {
      textarea.value = state.value;
    });
    expect(await fillCodeforcesFormInPage(args(true))).toMatchObject({
      status: "submit-triggered",
    });
    expect(state.value).toBe(args().code);
    expect(textarea.value).toBe(args().code);
  });

  it("supports the current Codeforces submit form and Ace editor contract", async () => {
    document.body.innerHTML = `
      <form class="submitFrameForm" method="post" action="/data/submit?csrf_token=test">
        <select name="programTypeId"><option value="54">GNU C++17</option></select>
        <div id="editor" class="ace_editor"></div>
        <textarea id="sourceCodeTextarea" name="source"></textarea>
        <input class="submit-form-submit" type="button" value="Submit">
      </form>`;
    const form = document.querySelector<HTMLFormElement>("form")!;
    const source = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const state = { value: "" };
    Object.defineProperty(window, "ace", {
      configurable: true,
      value: {
        edit: () => ({
          getValue: () => state.value,
          setValue: (value: string) => {
            state.value = value;
          },
        }),
      },
    });
    Object.defineProperty(form.querySelector("input"), "click", {
      value: vi.fn(() =>
        form.dispatchEvent(
          new SubmitEvent("submit", { bubbles: true, cancelable: true }),
        ),
      ),
    });
    expect(inspectCodeforcesFormInPage()).toMatchObject({
      status: "ready",
      codePresent: false,
    });
    expect(await fillCodeforcesFormInPage(args(true))).toMatchObject({
      status: "submit-triggered",
    });
    expect(state.value).toBe(args().code);
    expect(source.value).toBe(args().code);
  });

  it("does not fall back to a hidden textarea when CodeMirror is unaddressable", async () => {
    addSubmitFixture("", { withCodeMirror: false });
    const wrapper = document.createElement("div");
    wrapper.className = "CodeMirror";
    document.querySelector("form")!.append(wrapper);
    expect(inspectCodeforcesFormInPage()).toEqual({
      status: "editor-unavailable",
    });
    expect(await fillCodeforcesFormInPage(args(true))).toEqual({
      status: "editor-unavailable",
    });
  });

  it("does not overwrite existing code", async () => {
    addSubmitFixture("user draft");
    expect(await fillCodeforcesFormInPage(args())).toEqual({
      status: "existing-code",
    });
  });

  it("waits for the live editor instead of writing a textarea before initialization", async () => {
    addSubmitFixture("", { withCodeMirror: false });
    expect(inspectCodeforcesFormInPage()).toEqual({
      status: "editor-unavailable",
    });
    expect(await fillCodeforcesFormInPage(args(true))).toEqual({
      status: "editor-unavailable",
    });
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "",
    );
    expect(
      document.querySelector<HTMLButtonElement>("button[type=submit]")?.click,
    ).not.toHaveBeenCalled();
  });

  it("blocks submission if Codeforces overwrites the form source before submit", async () => {
    addSubmitFixture();
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    document.querySelector("form")!.addEventListener("submit", () => {
      textarea.value = "";
    });
    expect(await fillCodeforcesFormInPage(args(true))).toEqual({
      status: "submit-blocked",
      reason: "source-mismatch",
    });
  });

  it("requires exactly one native submit control", async () => {
    addSubmitFixture();
    document.querySelector("button[type=submit]")!.remove();
    expect(await fillCodeforcesFormInPage(args(true))).toEqual({
      status: "submit-blocked",
      reason: "submit-control-not-found",
    });

    addSubmitFixture();
    const original = document.querySelector("button[type=submit]")!;
    const duplicate = original.cloneNode(true);
    document.querySelector("form")!.append(duplicate);
    expect(await fillCodeforcesFormInPage(args(true))).toEqual({
      status: "submit-blocked",
      reason: "submit-control-ambiguous",
    });
  });

  it("waits for the Cloudflare token before activating the native submit control", async () => {
    addSubmitFixture();
    const widget = document.createElement("div");
    widget.className = "cf-turnstile";
    widget.style.position = "relative";
    document.querySelector("form")!.append(widget);
    const token = document.createElement("input");
    token.name = "cf-turnstile-response";
    token.value = "verified-token-value";
    document.querySelector("form")!.append(token);

    expect(await fillCodeforcesFormInPage(args(true))).toMatchObject({
      status: "submit-triggered",
    });
    expect(widget.style.position).toBe("relative");
    expect(document.getElementById("ojtrace-cf-shield-overlay")).toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>("button[type=submit]")?.click,
    ).toHaveBeenCalledOnce();
  });

  it("does not submit when Cloudflare verification never completes", async () => {
    addSubmitFixture();
    const widget = document.createElement("div");
    widget.className = "cf-turnstile";
    document.querySelector("form")!.append(widget);
    const click = document.querySelector<HTMLButtonElement>(
      "button[type=submit]",
    )?.click;

    vi.useFakeTimers();
    try {
      const filling = fillCodeforcesFormInPage(args(true));
      expect(
        document.getElementById("ojtrace-cf-shield-overlay"),
      ).not.toBeNull();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(await filling).toEqual({
        status: "submit-blocked",
        reason: "challenge-timeout",
      });
      expect(document.getElementById("ojtrace-cf-shield-overlay")).toBeNull();
      expect(click).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
