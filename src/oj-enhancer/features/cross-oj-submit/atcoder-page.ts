import type {
  AtCoderProblemRef,
  CrossOjFillResult,
  CrossOjFormInspection,
  CrossOjLanguageOption,
} from "./model";

export function inspectAtCoderFormInPage(expected: {
  problem: AtCoderProblemRef;
}): CrossOjFormInspection {
  type EditorLike = { getValue?: () => string };
  type PageWindow = Window & {
    ace?: { edit?: (element: Element | string) => EditorLike };
  };
  const text = `${document.title} ${document.body?.innerText?.slice(0, 1000) ?? ""}`;
  if (
    /just a moment|checking your browser|verify you are human|cloudflare/i.test(
      text,
    ) &&
    !document.querySelector("form.form-code-submit")
  )
    return { status: "security-check" };
  if (
    /\/login(?:\/|$)/.test(location.pathname) ||
    document.querySelector('form[action*="/login"]')
  )
    return { status: "login-required" };
  const form = document.querySelector<HTMLFormElement>("form.form-code-submit");
  if (!form) return { status: "form-unavailable" };
  const taskSelect = form.querySelector<HTMLSelectElement>(
    '#select-task[name="data.TaskScreenName"]',
  );
  if (!taskSelect) return { status: "form-unavailable" };
  const targetTask = Array.from(taskSelect.options).find(
    (option) =>
      option.value.toLowerCase() === expected.problem.taskId.toLowerCase(),
  );
  if (!targetTask) return { status: "problem-mismatch" };
  const languageSelect = form.querySelector<HTMLSelectElement>(
    'select[name="data.LanguageId"].current, #select-lang select.current, select[name="data.LanguageId"]',
  );
  if (!languageSelect) return { status: "form-unavailable" };
  const languageOptions: CrossOjLanguageOption[] = Array.from(
    languageSelect.options,
  )
    .filter((option) => option.value && option.textContent?.trim())
    .map((option) => ({
      value: option.value,
      label: option.textContent!.trim(),
    }));
  const page = window as PageWindow;
  const aceNode = form.querySelector("#editor.ace_editor");
  const plainTextarea = form.querySelector<HTMLTextAreaElement>(
    "#plain-textarea[name='sourceCode']",
  );
  let editorValue: string | undefined;
  const plainVisible =
    !!plainTextarea && getComputedStyle(plainTextarea).display !== "none";
  if (plainVisible) editorValue = plainTextarea.value;
  if (!plainVisible && aceNode && page.ace?.edit) {
    try {
      editorValue = page.ace.edit(aceNode).getValue?.();
    } catch {
      editorValue = undefined;
    }
  }
  if (
    editorValue === undefined &&
    plainTextarea &&
    getComputedStyle(plainTextarea).display !== "none"
  )
    editorValue = plainTextarea.value;
  if (editorValue === undefined) return { status: "editor-unavailable" };
  return {
    status: "ready",
    languageOptions,
    codePresent: editorValue.length > 0,
    problemMatches: true,
  };
}

export function fillAtCoderFormInPage(args: {
  problem: AtCoderProblemRef;
  code: string;
  languageValue: string;
}): CrossOjFillResult {
  if (
    location.origin !== "https://atcoder.jp" ||
    /^\/contests\/([a-z0-9-]+)\/submit\/?$/i
      .exec(location.pathname)?.[1]
      ?.toLowerCase() !== args.problem.contestId.toLowerCase()
  )
    return { status: "problem-mismatch" };
  type EditorLike = {
    getValue?: () => string;
    setValue?: (value: string) => void;
  };
  type PageWindow = Window & {
    ace?: { edit?: (element: Element | string) => EditorLike };
  };
  const form = document.querySelector<HTMLFormElement>("form.form-code-submit");
  if (!form) return { status: "changed" };
  const taskSelect = form.querySelector<HTMLSelectElement>(
    '#select-task[name="data.TaskScreenName"]',
  );
  if (!taskSelect) return { status: "problem-mismatch" };
  const targetTask = Array.from(taskSelect.options).find(
    (option) =>
      option.value.toLowerCase() === args.problem.taskId.toLowerCase(),
  );
  if (!targetTask) return { status: "problem-mismatch" };
  const languageSelect = form.querySelector<HTMLSelectElement>(
    'select[name="data.LanguageId"].current, #select-lang select.current, select[name="data.LanguageId"]',
  );
  const languageOption = Array.from(languageSelect?.options ?? []).find(
    (option) => option.value === args.languageValue,
  );
  if (!languageSelect || !languageOption)
    return { status: "language-mismatch" };
  const page = window as PageWindow;
  const aceNode = form.querySelector("#editor.ace_editor");
  const plainTextarea = form.querySelector<HTMLTextAreaElement>(
    "#plain-textarea[name='sourceCode']",
  );
  let editor: EditorLike | undefined;
  const plainVisible =
    !!plainTextarea && getComputedStyle(plainTextarea).display !== "none";
  if (!plainVisible && aceNode && page.ace?.edit) {
    try {
      editor = page.ace.edit(aceNode);
    } catch {
      editor = undefined;
    }
  }
  const current =
    editor?.getValue?.() ?? (plainVisible ? plainTextarea?.value : undefined);
  if (current === undefined) return { status: "editor-unavailable" };
  if (current.length > 0) return { status: "existing-code" };
  if (taskSelect.value !== targetTask.value) {
    taskSelect.value = targetTask.value;
    taskSelect.dispatchEvent(new Event("input", { bubbles: true }));
    taskSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }
  languageSelect.value = languageOption.value;
  languageSelect.dispatchEvent(new Event("input", { bubbles: true }));
  languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
  if (editor?.setValue) editor.setValue(args.code);
  else if (plainVisible && plainTextarea) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(plainTextarea, args.code);
    plainTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    plainTextarea.dispatchEvent(new Event("change", { bubbles: true }));
  } else return { status: "editor-unavailable" };
  const finalValue =
    editor?.getValue?.() ?? (plainVisible ? plainTextarea?.value : undefined);
  if (finalValue !== args.code) return { status: "changed" };
  return {
    status: "filled",
    languageLabel: languageOption.textContent?.trim() ?? "",
  };
}
