// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://atcoder.jp/contests/abc175/submit"}
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("selects the requested task, language and full source without submitting", async () => {
    const { editor } = formFixture();
    const result = await fillAtCoderFormInPage({
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

  it("preserves any code already present in the target editor", async () => {
    const { editor } = formFixture("user code");
    expect(inspectAtCoderFormInPage({ problem })).toMatchObject({
      codePresent: true,
    });
    expect(
      document.querySelector<HTMLSelectElement>("#select-task")!.value,
    ).toBe("abc175_a");
    expect(
      await fillAtCoderFormInPage({
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

  it("uses the visible plain text editor and preserves an inactive ACE draft", async () => {
    const { editor } = formFixture("inactive draft");
    const source =
      document.querySelector<HTMLTextAreaElement>("#plain-textarea")!;
    source.style.display = "block";
    const code = "line 1\n\n  line 3\n";
    expect(
      await fillAtCoderFormInPage({ problem, code, languageValue: "6000" }),
    ).toMatchObject({ status: "filled" });
    expect(source.value).toBe(code);
    expect(editor.value).toBe("inactive draft");
  });

  it("clicks AtCoder's native submit control after filling", async () => {
    const { editor } = formFixture();
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Submit";
    document.querySelector("form")!.append(submit);
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submitted);
    await expect(
      fillAtCoderFormInPage({
        problem,
        code: "int main() {}",
        languageValue: "6000",
        submit: true,
      }),
    ).resolves.toMatchObject({ status: "submit-triggered" });
    expect(editor.value).toBe("int main() {}");
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("waits for AtCoder's native Turnstile token before clicking Submit", async () => {
    formFixture();
    const form = document.querySelector("form")!;
    const widget = document.createElement("div");
    widget.className = "cf-turnstile";
    form.append(widget);
    const token = document.createElement("input");
    token.name = "cf-turnstile-response";
    token.value = "native-turnstile-token-value";
    form.append(token);
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Submit";
    form.append(submit);
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submitted);

    await expect(
      fillAtCoderFormInPage({
        problem,
        code: "int main() {}",
        languageValue: "6000",
        submit: true,
      }),
    ).resolves.toMatchObject({ status: "submit-triggered" });
    expect(submitted).toHaveBeenCalledOnce();
    expect(token.value).toBe("native-turnstile-token-value");
  });
});
