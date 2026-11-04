// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://atcoder.jp/contests/abc175/submit"}
import { afterEach, describe, expect, it } from "vitest";
import {
  fillAtCoderFormInPage,
  inspectAtCoderFormInPage,
} from "../../src/oj-enhancer/features/cross-oj-submit/atcoder-page";
import type { AtCoderProblemRef } from "../../src/oj-enhancer/features/cross-oj-submit/model";

const problem: AtCoderProblemRef = {
  oj: "atcoder",
  contestId: "abc175",
  taskId: "abc175_f",
  source: "luogu-pid",
};

afterEach(() => {
  document.body.replaceChildren();
  delete (window as Window & { ace?: unknown }).ace;
});

function formFixture(code = "") {
  document.body.innerHTML = `
    <form class="form-code-submit" action="/contests/abc175/submit">
      <select id="select-task" name="data.TaskScreenName">
        <option value="abc175_a">A</option><option value="abc175_f">F</option>
      </select>
      <select class="current" name="data.LanguageId">
        <option value="">-</option><option value="6000">C++20 (GCC)</option>
      </select>
      <div id="editor" class="ace_editor"></div>
      <textarea id="plain-textarea" name="sourceCode" style="display:none"></textarea>
    </form>`;
  const editor = {
    value: code,
    getValue() {
      return this.value;
    },
    setValue(value: string) {
      this.value = value;
    },
  };
  (window as Window & { ace?: unknown }).ace = {
    edit: () => editor,
  };
  return { editor };
}

describe("AtCoder native form adapter", () => {
  it("checks the selected task and reads options/code from the ACE API", () => {
    formFixture("print('ok')\n");
    const result = inspectAtCoderFormInPage({ problem });
    expect(result).toMatchObject({
      status: "ready",
      codePresent: true,
      problemMatches: true,
      languageOptions: [{ value: "6000", label: "C++20 (GCC)" }],
    });
  });

  it("selects the requested task, language and full source without submitting", () => {
    const { editor } = formFixture();
    const result = fillAtCoderFormInPage({
      problem,
      code: "#include <bits/stdc++.h>\nint main() {}\n",
      languageValue: "6000",
    });
    expect(result).toMatchObject({ status: "filled" });
    expect(editor.value).toBe("#include <bits/stdc++.h>\nint main() {}\n");
    expect(
      document.querySelector<HTMLSelectElement>("#select-task")?.value,
    ).toBe("abc175_f");
    expect(
      document.querySelector<HTMLSelectElement>(
        'select[name="data.LanguageId"]',
      )?.value,
    ).toBe("6000");
  });

  it("preserves any code already present in the target editor", () => {
    const { editor } = formFixture("user code");
    expect(inspectAtCoderFormInPage({ problem })).toMatchObject({
      codePresent: true,
    });
    expect(
      document.querySelector<HTMLSelectElement>("#select-task")!.value,
    ).toBe("abc175_a");
    expect(
      fillAtCoderFormInPage({
        problem,
        code: "replacement",
        languageValue: "6000",
      }),
    ).toEqual({ status: "existing-code" });
    expect(editor.value).toBe("user code");
    expect(
      document.querySelector<HTMLSelectElement>("#select-task")!.value,
    ).toBe("abc175_a");
  });

  it("uses the visible plain text editor and preserves an inactive ACE draft", () => {
    const { editor } = formFixture("inactive draft");
    const source =
      document.querySelector<HTMLTextAreaElement>("#plain-textarea")!;
    source.style.display = "block";
    const code = "line 1\n\n  line 3\n";
    expect(
      fillAtCoderFormInPage({ problem, code, languageValue: "6000" }),
    ).toMatchObject({ status: "filled" });
    expect(source.value).toBe(code);
    expect(editor.value).toBe("inactive draft");
  });
});
