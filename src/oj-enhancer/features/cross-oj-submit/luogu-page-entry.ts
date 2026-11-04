import type { CrossOjProblemRef } from "./model";

export const LUOGU_CROSS_OJ_ENTRY_ID = "ojtrace-cross-oj-submit-entry";
export const LUOGU_CROSS_OJ_STATUS_ID = "ojtrace-cross-oj-submit-status";

function isLuoguSubmitButton(button: HTMLButtonElement): boolean {
  return /^(提交评测|Submit to Judge)$/.test(
    (button.innerText || button.textContent || "").trim(),
  );
}

function nodeContainsLuoguSubmitButton(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return false;
  const closestButton = element.closest("button");
  if (
    closestButton instanceof HTMLButtonElement &&
    isLuoguSubmitButton(closestButton)
  )
    return true;
  return Array.from(element.querySelectorAll<HTMLButtonElement>("button")).some(
    isLuoguSubmitButton,
  );
}

function nodeIsWithinLuoguPageContext(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return false;
  return Boolean(element.closest("script#lentille-context"));
}

function nodeContainsLuoguPageContext(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return false;
  return (
    nodeIsWithinLuoguPageContext(node) ||
    element.matches("script#lentille-context") ||
    Boolean(element.querySelector("script#lentille-context"))
  );
}

export interface LuoguNativeSubmitUiInspection {
  fileUploaderVisible: boolean;
  candidateCount: number;
  visibleCandidateCount: number;
  candidateSizes: Array<{ width: number; height: number }>;
  nativeButton?: HTMLButtonElement;
}

export interface LuoguSubmitUiObserver {
  disconnect(): void;
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

/** Inspect Luogu's native submit controls, including currently collapsed ones. */
export function inspectLuoguNativeSubmitUi(
  root: ParentNode = document,
): LuoguNativeSubmitUiInspection {
  const fileUploaderVisible = Array.from(
    root.querySelectorAll<HTMLElement>(".drop"),
  ).some(isVisible);
  const candidates = Array.from(
    root.querySelectorAll<HTMLButtonElement>("button"),
  ).filter(isLuoguSubmitButton);
  const visibleCandidates = candidates.filter(isVisible);
  const candidateSizes = candidates.map((button) => {
    const rect = button.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  return {
    fileUploaderVisible,
    candidateCount: candidates.length,
    visibleCandidateCount: visibleCandidates.length,
    candidateSizes,
    nativeButton:
      !fileUploaderVisible && visibleCandidates.length === 1
        ? visibleCandidates[0]
        : undefined,
  };
}

/** Watch Luogu's lazy submit panel, including v-show/class-based visibility. */
export function observeLuoguSubmitUiChanges(
  onChange: () => void,
  root: Node = document,
): LuoguSubmitUiObserver {
  const observedTargets = new Set<Element>();
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver((entries) => {
          if (
            entries.some(
              ({ contentRect }) =>
                contentRect.width > 0 && contentRect.height > 0,
            )
          )
            onChange();
        });

  function syncObservedButtons(): void {
    if (!resizeObserver) return;
    const queryRoot = root as ParentNode;
    const candidates = Array.from(
      queryRoot.querySelectorAll<HTMLButtonElement>("button"),
    ).filter(isLuoguSubmitButton);
    const nextTargets = new Set<Element>();
    for (const button of candidates) {
      let target: Element | null = button;
      let ancestorCount = 0;
      while (target && ancestorCount < 8) {
        nextTargets.add(target);
        if (target === root) break;
        target = target.parentElement;
        ancestorCount += 1;
      }
    }
    for (const target of observedTargets) {
      if (!nextTargets.has(target)) resizeObserver.unobserve(target);
    }
    for (const target of nextTargets) {
      if (!observedTargets.has(target)) resizeObserver.observe(target);
    }
    observedTargets.clear();
    for (const target of nextTargets) observedTargets.add(target);
  }

  const observer = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      if (record.type === "childList")
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            nodeContainsLuoguSubmitButton(node) ||
            nodeContainsLuoguPageContext(node),
        );
      return (
        nodeContainsLuoguSubmitButton(record.target) ||
        nodeIsWithinLuoguPageContext(record.target)
      );
    });
    if (relevant) {
      syncObservedButtons();
      onChange();
    }
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    characterData: true,
    childList: true,
    subtree: true,
  });
  syncObservedButtons();
  return {
    disconnect() {
      observer.disconnect();
      resizeObserver?.disconnect();
    },
  };
}

export function findLuoguNativeSubmitButton(
  root: ParentNode = document,
): HTMLButtonElement | undefined {
  return inspectLuoguNativeSubmitUi(root).nativeButton;
}

export function insertLuoguCrossOjEntry(
  native: HTMLButtonElement,
  problem: CrossOjProblemRef,
  onActivate: (entry: HTMLButtonElement, event: MouseEvent) => void,
): HTMLButtonElement {
  document.getElementById(LUOGU_CROSS_OJ_ENTRY_ID)?.remove();
  const entry = document.createElement("button");
  entry.id = LUOGU_CROSS_OJ_ENTRY_ID;
  entry.type = "button";
  entry.textContent =
    problem.oj === "codeforces" ? "提交到 Codeforces" : "填入 AtCoder";
  entry.setAttribute(
    "aria-label",
    problem.oj === "codeforces"
      ? "将洛谷代码直接提交到 Codeforces"
      : "将洛谷代码填入 AtCoder 提交页",
  );
  entry.className = native.className;
  // Luogu's button theme is Vue-scoped. Its selectors include generated
  // data-v-* attributes, so copying only the class names loses the blue
  // state and hover rules on an extension-created sibling.
  for (const attribute of Array.from(native.attributes)) {
    if (attribute.name.startsWith("data-v-"))
      entry.setAttribute(attribute.name, attribute.value);
  }
  const style = getComputedStyle(native);
  const nativeRect = native.getBoundingClientRect();
  Object.assign(entry.style, {
    // Keep Luogu's inline formatting, then correct the rendered geometry
    // after insertion. The two labels can have different font fallback and
    // therefore different inline baselines even with the same button styles.
    display: style.display,
    verticalAlign: style.verticalAlign,
    marginLeft: "8px",
    marginTop: style.marginTop,
    marginRight: style.marginRight,
    marginBottom: style.marginBottom,
    cursor: "pointer",
    boxSizing: "border-box",
    height: `${nativeRect.height}px`,
    position: "relative",
  });
  entry.addEventListener("click", (event) => onActivate(entry, event));
  native.insertAdjacentElement("afterend", entry);
  const entryRect = entry.getBoundingClientRect();
  entry.style.top = `${nativeRect.top - entryRect.top}px`;
  return entry;
}

export function updateLuoguCrossOjStatus(
  message: string,
  color = "#a33e3e",
): HTMLSpanElement {
  let status = document.getElementById(
    LUOGU_CROSS_OJ_STATUS_ID,
  ) as HTMLSpanElement | null;
  if (!status) {
    status = document.createElement("span");
    status.id = LUOGU_CROSS_OJ_STATUS_ID;
    status.setAttribute("role", "status");
    status.dataset.ojtraceCrossOjStatus = "true";
    status.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;box-sizing:border-box;max-width:min(420px,calc(100vw - 32px));padding:10px 14px;border:1px solid #e2b9b9;border-radius:8px;background:#fff;color:#a33e3e;box-shadow:0 6px 20px #0002;font:13px/1.5 system-ui,sans-serif;white-space:normal;overflow-wrap:anywhere";
  }
  status.textContent = message;
  status.style.color = color;
  document.body.append(status);
  return status;
}
