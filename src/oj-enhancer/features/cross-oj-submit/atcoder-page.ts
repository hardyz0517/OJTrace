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

export async function fillAtCoderFormInPage(args: {
  problem: AtCoderProblemRef;
  code: string;
  languageValue: string;
  submit?: boolean;
}): Promise<CrossOjFillResult> {
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
  if (args.submit && !plainTextarea)
    return { status: "submit-blocked", reason: "source-mismatch" };
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
  if (
    taskSelect.value !== targetTask.value ||
    languageSelect.value !== languageOption.value
  )
    return { status: "changed" };
  try {
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
  } catch {
    return { status: "changed" };
  }
  // AtCoder's ACE editor can leave its backing field stale until form submit.
  // Keep the native field in sync as well; the site still owns the submission.
  if (plainTextarea) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(plainTextarea, args.code);
    plainTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    plainTextarea.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const finalValue = editor?.getValue?.() ?? plainTextarea?.value;
  if (finalValue !== args.code) return { status: "changed" };
  if (!args.submit)
    return {
      status: "filled",
      languageLabel: languageOption.textContent?.trim() ?? "",
    };

  // Reuse AtCoder's own Turnstile widget and native form. We never synthesize
  // a token or replay a POST; the user may complete the visible verification
  // and the native submit control sends the validated form exactly once.
  const challengeWidget = document.querySelector<HTMLElement>(
    ".cf-challenge, .cf-turnstile, iframe[src*='challenges.cloudflare.com'], [data-callback*='turnstile']",
  );
  if (challengeWidget) {
    const verified = await new Promise<boolean>((resolve) => {
      const startedAt = Date.now();
      const poll = (): void => {
        const tokenPresent = Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            'input[name="turnstileToken"], input[name^="cf-turnstile-response"], textarea[name="cf-turnstile-response"]',
          ),
        ).some((field) => field.value.trim().length > 10);
        if (tokenPresent) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= 120_000) {
          resolve(false);
          return;
        }
        window.setTimeout(poll, 250);
      };
      poll();
    });
    if (!verified)
      return { status: "submit-blocked", reason: "challenge-timeout" };
  }

  const submitControls = Array.from(
    form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button[type="submit"], button:not([type]), input[type="submit"]',
    ),
  ).filter(
    (control) =>
      control.form === form &&
      !control.disabled &&
      (control instanceof HTMLInputElement || control.type === "submit"),
  );
  if (submitControls.length === 0)
    return { status: "submit-blocked", reason: "submit-control-not-found" };
  if (submitControls.length !== 1)
    return { status: "submit-blocked", reason: "submit-control-ambiguous" };

  try {
    let baselineSubmissionId: string | undefined;
    let baselineTimeout: number | undefined;
    try {
      const controller = new AbortController();
      baselineTimeout = window.setTimeout(() => controller.abort(), 4_000);
      const response = await fetch(
        `/contests/${encodeURIComponent(args.problem.contestId)}/submissions/me/status/json`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      if (response.ok) {
        const payload: unknown = await response.json();
        if (
          payload &&
          typeof payload === "object" &&
          "Result" in payload &&
          payload.Result &&
          typeof payload.Result === "object" &&
          !Array.isArray(payload.Result)
        ) {
          const ids = Object.keys(payload.Result).filter((id) =>
            /^\d+$/.test(id),
          );
          baselineSubmissionId = ids.reduce(
            (max, id) => (BigInt(id) > BigInt(max ?? "0") ? id : max),
            undefined as string | undefined,
          );
        }
      }
    } catch {
      // Result correlation can safely fall back to the submission timestamp.
    } finally {
      if (baselineTimeout !== undefined) window.clearTimeout(baselineTimeout);
    }
    sessionStorage.setItem(
      "ojtrace:atcoder:expected-problem",
      JSON.stringify({
        oj: "atcoder",
        contestId: args.problem.contestId,
        taskId: args.problem.taskId,
        startedAt: Date.now(),
        baselineSubmissionId,
      }),
    );
  } catch {
    // Submission can still proceed; the detail route remains the fallback.
  }

  let submitEventObserved = false;
  let sourceMismatch = false;
  const verifyNativePayload = (event: Event): void => {
    submitEventObserved = true;
    if (plainTextarea && plainTextarea.value !== args.code) {
      sourceMismatch = true;
      event.preventDefault();
    }
  };
  form.addEventListener("submit", verifyNativePayload, { capture: true });
  try {
    submitControls[0]!.click();
  } catch {
    form.removeEventListener("submit", verifyNativePayload, { capture: true });
    return { status: "submit-blocked", reason: "submit-control-error" };
  }
  form.removeEventListener("submit", verifyNativePayload, { capture: true });
  if (sourceMismatch)
    return { status: "submit-blocked", reason: "source-mismatch" };
  return {
    status: submitEventObserved ? "submit-triggered" : "submit-attempted",
    languageLabel: languageOption.textContent?.trim() ?? "",
  };
}
