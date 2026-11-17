import type {
  CrossOjFillResult,
  CrossOjFormInspection,
  ProblemRef,
} from "./model";

/** Serialized into Codeforces' MAIN world by the MV3 service worker. */
export function inspectCodeforcesFormInPage(): CrossOjFormInspection {
  type EditorLike = {
    getValue?: () => string;
    getWrapperElement?: () => HTMLElement;
  };
  type CodeMirrorTextArea = HTMLTextAreaElement & { CodeMirror?: EditorLike };
  type CodeMirrorWrapper = HTMLElement & { CodeMirror?: EditorLike };
  type PageWindow = Window & {
    ace?: { edit?: (element: Element | string) => EditorLike };
    monaco?: {
      editor?: {
        getEditors?: () => Array<
          EditorLike & { getDomNode?: () => HTMLElement | null }
        >;
      };
    };
  };
  const page = window as PageWindow;
  const text = `${document.title} ${document.body?.innerText?.slice(0, 1200) ?? ""}`;
  if (
    /just a moment|checking your browser|verify you are human|cloudflare/i.test(
      text,
    ) &&
    !document.querySelector("form#submitForm, form[action*='submit']")
  )
    return { status: "security-check" };
  if (
    location.pathname === "/enter" ||
    location.pathname.startsWith("/enter/") ||
    document.querySelector("form#enterForm, form[action*='/enter']")
  )
    return { status: "login-required" };
  const forms = Array.from(
    document.querySelectorAll<HTMLFormElement>(
      "form#submitForm, form[action*='/submit'], form.submitFrameForm, form.submit-form, form[method='post'][action*='csrf_token']",
    ),
  );
  if (forms.length !== 1) return { status: "form-unavailable" };
  const form = forms[0]!;
  const languageSelect = form.querySelector<HTMLSelectElement>(
    'select[name="programTypeId"], select#programTypeId, select[name*="programType"]',
  );
  if (!languageSelect) return { status: "form-unavailable" };
  const languageOptions = Array.from(languageSelect.options)
    .filter((option) => option.value)
    .map((option) => ({
      value: option.value,
      label: (option.textContent ?? "").trim(),
    }))
    .filter((option) => option.label);

  const aceNode = form.querySelector(".ace_editor");
  let editorValue: string | undefined;
  if (aceNode && page.ace?.edit) {
    try {
      editorValue = page.ace.edit(aceNode).getValue?.();
    } catch {
      editorValue = undefined;
    }
  }
  if (editorValue === undefined) {
    const editors = (page.monaco?.editor?.getEditors?.() ?? []).filter(
      (item) => {
        const node = item.getDomNode?.();
        return !!node && form.contains(node);
      },
    );
    if (editors.length === 1) editorValue = editors[0]?.getValue?.();
  }
  if (editorValue === undefined) {
    const instances = new Set<EditorLike>();
    for (const textarea of form.querySelectorAll<CodeMirrorTextArea>(
      "textarea",
    )) {
      const instance = textarea.CodeMirror;
      if (!instance?.getValue) continue;
      try {
        const wrapper = instance.getWrapperElement?.();
        if (wrapper && form.contains(wrapper)) instances.add(instance);
      } catch {
        // An editor that cannot prove it belongs to this form is ambiguous.
      }
    }
    for (const wrapper of form.querySelectorAll<CodeMirrorWrapper>(
      ".CodeMirror",
    )) {
      if (wrapper.CodeMirror?.getValue) instances.add(wrapper.CodeMirror);
    }
    if (instances.size === 1) editorValue = [...instances][0]?.getValue?.();
  }
  // Codeforces' source textarea is only the form's backing field. It can
  // exist before CodeMirror initializes, and writing it directly is lost when
  // CodeMirror later saves its still-empty buffer during form submission.
  // Only report ready after reading a live editor API above.
  if (editorValue === undefined) return { status: "editor-unavailable" };
  let accountHandle: string | undefined;
  const profile = document.querySelector<HTMLAnchorElement>(
    '#header a[href^="/profile/"], header a[href^="/profile/"]',
  );
  if (profile) {
    try {
      const profilePath = new URL(profile.href).pathname;
      const match = /^\/profile\/([A-Za-z0-9_.-]{3,24})\/?$/.exec(profilePath);
      accountHandle = match?.[1];
    } catch {
      // Keep account correlation optional when the page has no usable profile link.
    }
  }
  return {
    status: "ready",
    languageOptions,
    codePresent: editorValue.length > 0,
    ...(accountHandle ? { accountHandle } : {}),
  };
}

/** Serialized into Codeforces' MAIN world after source/task checks pass. */
export async function fillCodeforcesFormInPage(args: {
  problem: ProblemRef;
  code: string;
  languageValue: string;
  submit?: boolean;
}): Promise<CrossOjFillResult> {
  type EditorLike = {
    getValue?: () => string;
    setValue?: (value: string) => void;
    getWrapperElement?: () => HTMLElement;
    save?: () => void;
  };
  type CodeMirrorTextArea = HTMLTextAreaElement & { CodeMirror?: EditorLike };
  type CodeMirrorWrapper = HTMLElement & { CodeMirror?: EditorLike };
  type PageWindow = Window & {
    ace?: { edit?: (element: Element | string) => EditorLike };
    monaco?: {
      editor?: {
        getEditors?: () => Array<
          EditorLike & { getDomNode?: () => HTMLElement | null }
        >;
      };
    };
  };
  const page = window as PageWindow;
  if (args.problem.oj !== "codeforces") return { status: "problem-mismatch" };
  const currentUrl = new URL(location.href);
  const currentContestId =
    /^\/contest\/(\d+)\/submit\/?$/.exec(currentUrl.pathname)?.[1] ??
    currentUrl.searchParams.get("contestId");
  if (
    currentUrl.origin !== "https://codeforces.com" ||
    currentContestId !== args.problem.contestId
  )
    return { status: "problem-mismatch" };
  const forms = Array.from(
    document.querySelectorAll<HTMLFormElement>(
      "form#submitForm, form[action*='/submit'], form.submitFrameForm, form.submit-form, form[method='post'][action*='csrf_token']",
    ),
  );
  if (forms.length !== 1) return { status: "changed" };
  const form = forms[0]!;
  const languageSelect = form.querySelector<HTMLSelectElement>(
    'select[name="programTypeId"], select#programTypeId, select[name*="programType"]',
  );
  const languageOption = Array.from(languageSelect?.options ?? []).find(
    (option) => option.value === args.languageValue,
  );
  if (!languageSelect || !languageOption)
    return { status: "language-mismatch" };

  const problemSelect = form.querySelector<HTMLSelectElement>(
    'select[name="submittedProblemIndex"], select#submittedProblemIndex, select[name="problemIndex"]',
  );
  if (problemSelect) {
    const matching = Array.from(problemSelect.options).find(
      (option) => option.value.toUpperCase() === args.problem.index,
    );
    if (!matching) return { status: "problem-mismatch" };
    if (problemSelect.value !== matching.value) {
      problemSelect.value = matching.value;
      problemSelect.dispatchEvent(new Event("input", { bubbles: true }));
      problemSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else {
    const routeIndex = currentUrl.searchParams
      .get("problemIndex")
      ?.toUpperCase();
    if (routeIndex !== args.problem.index)
      return { status: "problem-mismatch" };
  }

  const aceNode = form.querySelector(".ace_editor");
  let editor: EditorLike | undefined;
  if (aceNode && page.ace?.edit) {
    try {
      editor = page.ace.edit(aceNode);
    } catch {
      editor = undefined;
    }
  }
  if (!editor) {
    const editors = (page.monaco?.editor?.getEditors?.() ?? []).filter(
      (item) => {
        const node = item.getDomNode?.();
        return !!node && form.contains(node);
      },
    );
    if (editors.length === 1) editor = editors[0];
  }

  let codeMirror: EditorLike | undefined;
  if (!editor) {
    const instances = new Set<EditorLike>();
    for (const textarea of form.querySelectorAll<CodeMirrorTextArea>(
      "textarea",
    )) {
      const instance = textarea.CodeMirror;
      if (!instance?.getValue || !instance.setValue) continue;
      try {
        const wrapper = instance.getWrapperElement?.();
        if (wrapper && form.contains(wrapper)) instances.add(instance);
      } catch {
        // Ignore instances that cannot be tied to the current form.
      }
    }
    for (const wrapper of form.querySelectorAll<CodeMirrorWrapper>(
      ".CodeMirror",
    )) {
      if (wrapper.CodeMirror?.getValue && wrapper.CodeMirror.setValue)
        instances.add(wrapper.CodeMirror);
    }
    if (instances.size === 1) codeMirror = [...instances][0];
  }

  const source =
    form.querySelector<HTMLTextAreaElement>(
      'textarea#sourceCodeTextarea, textarea[name="source"], textarea[name="code"]',
    ) ??
    Array.from(
      document.querySelectorAll<HTMLTextAreaElement>(
        'textarea#sourceCodeTextarea, textarea[name="source"], textarea[name="code"]',
      ),
    ).find((candidate) => candidate.form === form);
  const current = editor?.getValue?.() ?? codeMirror?.getValue?.();
  if (current === undefined) return { status: "editor-unavailable" };
  if (current.length > 0 || source?.value) return { status: "existing-code" };

  languageSelect.value = languageOption.value;
  languageSelect.dispatchEvent(new Event("input", { bubbles: true }));
  languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
  if (languageSelect.value !== args.languageValue)
    return { status: "language-mismatch" };

  try {
    if (editor?.setValue) {
      editor.setValue(args.code);
    } else if (codeMirror?.setValue) {
      codeMirror.setValue(args.code);
    } else {
      return { status: "editor-unavailable" };
    }
    const finalValue = editor?.getValue?.() ?? codeMirror?.getValue?.();
    if (finalValue !== args.code) return { status: "changed" };
    if (source) {
      // Ace and CodeMirror do not consistently update the backing field until
      // their own submit listener runs. Set it explicitly as well, so the
      // native form payload cannot be empty when that listener is absent or
      // runs after another page handler.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(source, args.code);
      source.dispatchEvent(new Event("input", { bubbles: true }));
      source.dispatchEvent(new Event("change", { bubbles: true }));
      codeMirror?.save?.();
      if (source.value !== args.code) return { status: "changed" };
    }
  } catch {
    return { status: "changed" };
  }
  if (!args.submit)
    return {
      status: "filled",
      languageLabel: languageOption.textContent?.trim() ?? "",
    };

  const challengeWidget = document.querySelector<HTMLElement>(
    ".cf-challenge, .cf-turnstile, iframe[src*='challenges.cloudflare.com'], [data-callback*='turnstile']",
  );
  let challengeOverlay: HTMLElement | undefined;
  let restoreChallengeStyle: (() => void) | undefined;
  if (challengeWidget) {
    const previousStyle = challengeWidget.getAttribute("style");
    challengeWidget.style.setProperty("position", "fixed", "important");
    challengeWidget.style.setProperty("top", "50%", "important");
    challengeWidget.style.setProperty("left", "50%", "important");
    challengeWidget.style.setProperty(
      "transform",
      "translate(-50%, -50%)",
      "important",
    );
    challengeWidget.style.setProperty("z-index", "2147483647", "important");
    challengeWidget.style.setProperty("margin", "0", "important");
    restoreChallengeStyle = () => {
      if (previousStyle === null) challengeWidget.removeAttribute("style");
      else challengeWidget.setAttribute("style", previousStyle);
    };
    challengeOverlay = document.createElement("section");
    challengeOverlay.id = "ojtrace-cf-shield-overlay";
    challengeOverlay.setAttribute("role", "status");
    Object.assign(challengeOverlay.style, {
      position: "fixed",
      zIndex: "2147483646",
      inset: "0",
      display: "grid",
      placeItems: "center",
      pointerEvents: "none",
      background: "rgba(15, 23, 42, 0.52)",
      font: "14px/1.5 system-ui, sans-serif",
    });
    const card = document.createElement("div");
    Object.assign(card.style, {
      width: "min(440px, calc(100vw - 32px))",
      padding: "24px",
      border: "1px solid #dbe3ed",
      borderRadius: "14px",
      background: "#fff",
      color: "#1c2430",
      textAlign: "center",
      boxShadow: "0 16px 48px #0004",
    });
    const title = document.createElement("strong");
    title.textContent = "请完成 Codeforces 安全验证";
    const hint = document.createElement("p");
    hint.textContent = "验证通过后，OJTrace 会自动继续提交。";
    hint.style.margin = "8px 0 0";
    card.append(title, hint);
    challengeOverlay.append(card);
    document.documentElement.append(challengeOverlay);
  }

  const cleanupChallengeUi = (): void => {
    challengeOverlay?.remove();
    restoreChallengeStyle?.();
  };
  if (challengeWidget) {
    let verified = false;
    for (let elapsed = 0; elapsed < 120_000; elapsed += 250) {
      verified = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          'input[name="cf-turnstile-response"], input[name^="cf-turnstile-response"], input[name="turnstileToken"], textarea[name="cf-turnstile-response"]',
        ),
      ).some((field) => field.value.trim().length > 10);
      if (verified) break;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
    }
    if (!verified) {
      cleanupChallengeUi();
      return {
        status: "submit-blocked",
        reason: "challenge-timeout",
      };
    }
  }

  const submitEventState: { event?: SubmitEvent } = {};
  let sourceMismatchAtSubmit = false;
  const inspectSubmit = (event: SubmitEvent): void => {
    submitEventState.event = event;
    cleanupChallengeUi();
    // CodeMirror 5 copies its live editor buffer to the hidden textarea from
    // an earlier form submit listener. Cancel if the posted field disagrees.
    if (source && source.value !== args.code) {
      sourceMismatchAtSubmit = true;
      event.preventDefault();
    }
  };
  form.addEventListener("submit", inspectSubmit, { once: true });
  try {
    const submitters = Array.from(
      form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button, input[type="submit"], input[type="button"], input:not([type])',
      ),
    ).filter((control) => {
      if (control.disabled || control.form !== form) return false;
      const nativeSubmit = control.type === "submit";
      const knownCodeforcesControl = control.matches(
        ".submit-form-submit, .submit, [name='action'][value='submitSolutionFormSubmitted']",
      );
      return nativeSubmit || knownCodeforcesControl;
    });
    // Restrict legacy Codeforces class selectors to actual form controls.
    // Broad document-wide `.submit` queries also match layout wrappers and
    // can falsely report multiple buttons even when the form has one Submit.
    if (submitters.length === 0)
      return {
        status: "submit-blocked",
        reason: "submit-control-not-found",
      };
    if (submitters.length > 1)
      return {
        status: "submit-blocked",
        reason: "submit-control-ambiguous",
      };
    submitters[0]!.click();
  } catch {
    return { status: "submit-blocked", reason: "submit-control-error" };
  } finally {
    form.removeEventListener("submit", inspectSubmit);
  }
  // A click is the most native operation available to an extension. Some CF
  // variants use a custom button handler and do not emit a submit event, so
  // distinguish the attempted control click from an observed form submission.
  if (sourceMismatchAtSubmit) {
    cleanupChallengeUi();
    return { status: "submit-blocked", reason: "source-mismatch" };
  }
  if (!submitEventState.event) cleanupChallengeUi();
  return {
    status: submitEventState.event ? "submit-triggered" : "submit-attempted",
    languageLabel: languageOption.textContent?.trim() ?? "",
  };
}
