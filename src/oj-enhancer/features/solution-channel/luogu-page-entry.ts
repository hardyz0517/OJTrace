export const LUOGU_SOLUTION_CHANNEL_BADGE_ID =
  "ojtrace-luogu-solution-channel-badge";
export const LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE =
  "data-ojtrace-luogu-solution-channel";
const SOLUTION_CHANNEL_LABEL = "题解通道开放";
const SOLUTION_CHANNEL_TAG_BACKGROUND = "#f39c11";
const SOLUTION_CHANNEL_TAG_BORDER = "#d98b05";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read Luogu's authoritative per-problem switch from its embedded page data.
 * Undefined means the page is not a fully identified problem page.
 */
export function readLuoguSolutionChannelState(
  root: ParentNode = document,
  pathname: string = location.pathname,
): boolean | undefined {
  const pathMatch = /^\/problem\/([^/]+)\/?$/.exec(pathname);
  if (!pathMatch) return undefined;

  let pathProblemId: string;
  try {
    pathProblemId = decodeURIComponent(pathMatch[1]!);
  } catch {
    return undefined;
  }

  const context = root.querySelector<HTMLScriptElement>(
    'script#lentille-context[type="application/json"]',
  );
  if (!context?.textContent) return undefined;

  try {
    const parsed: unknown = JSON.parse(context.textContent);
    if (!isRecord(parsed) || parsed.template !== "problem.show")
      return undefined;
    const data = parsed.data;
    if (!isRecord(data) || !isRecord(data.problem)) return undefined;

    const problem = data.problem;
    if (
      problem.pid !== pathProblemId ||
      typeof problem.acceptSolution !== "boolean"
    )
      return undefined;
    return problem.acceptSolution;
  } catch {
    return undefined;
  }
}

function findLuoguTagsContainer(root: ParentNode): HTMLElement | undefined {
  const headings = Array.from(
    root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  ).filter((heading) => heading.textContent?.trim() === "标签");
  if (headings.length !== 1) return undefined;

  let ancestor = headings[0]!.parentElement;
  while (ancestor) {
    const containers = ancestor.querySelectorAll<HTMLElement>(".tags");
    if (containers.length === 1) return containers[0];
    ancestor = ancestor.parentElement;
  }
  return undefined;
}

function cloneNativeLuoguTag(
  tagsContainer: HTMLElement,
): HTMLElement | undefined {
  const template = Array.from(tagsContainer.children).find(
    (element) =>
      !element.hasAttribute(LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE) &&
      (element.matches("span") || element.querySelector("span")),
  );
  if (!template) return undefined;

  const clone = template.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return undefined;
  const label =
    clone.tagName.toLowerCase() === "span"
      ? clone
      : clone.querySelector("span");
  if (!(label instanceof HTMLElement)) return undefined;

  label.textContent = SOLUTION_CHANNEL_LABEL;
  applySolutionChannelTagColor(label);
  // Keep every badge in Luogu's anchor hover path, even if the native tag
  // container only provides a span template.
  let wrapper: HTMLElement;
  if (clone.tagName.toLowerCase() === "a") wrapper = clone;
  else {
    wrapper = document.createElement("a");
    wrapper.append(clone);
  }
  wrapper.removeAttribute("href");
  wrapper.removeAttribute("target");
  wrapper.removeAttribute("rel");
  wrapper.style.cursor = "pointer";
  wrapper.setAttribute("role", "status");
  wrapper.setAttribute("aria-label", SOLUTION_CHANNEL_LABEL);
  wrapper.setAttribute(LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE, "true");
  wrapper.id = LUOGU_SOLUTION_CHANNEL_BADGE_ID;
  return wrapper;
}

function applySolutionChannelTagColor(label: HTMLElement): void {
  label.style.backgroundColor = SOLUTION_CHANNEL_TAG_BACKGROUND;
  label.style.borderColor = SOLUTION_CHANNEL_TAG_BORDER;
  label.style.color = "#fff";
}

function makeEmptyCardBadge(): HTMLElement {
  const wrapper = document.createElement("a");
  const label = document.createElement("span");
  label.textContent = SOLUTION_CHANNEL_LABEL;
  label.style.cssText = `display:inline-block;padding:2px 6px;border:1px solid ${SOLUTION_CHANNEL_TAG_BORDER};border-radius:2px;background:${SOLUTION_CHANNEL_TAG_BACKGROUND};color:#fff;font-size:12px;line-height:18px;white-space:nowrap`;
  wrapper.append(label);
  // Luogu's global `a:hover` rule provides the native brightness effect.
  // No href keeps this informational status from navigating anywhere.
  wrapper.style.cursor = "pointer";
  wrapper.setAttribute("role", "status");
  wrapper.setAttribute("aria-label", SOLUTION_CHANNEL_LABEL);
  wrapper.setAttribute(LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE, "true");
  wrapper.dataset.ojtraceFallbackTag = "true";
  wrapper.id = LUOGU_SOLUTION_CHANNEL_BADGE_ID;
  return wrapper;
}

/** Add or remove one native-looking status tag from the problem's tag card. */
export function reconcileLuoguSolutionChannelBadge(
  root: ParentNode = document,
  pathname: string = location.pathname,
): void {
  const existing = root.querySelector<HTMLElement>(
    `[${LUOGU_SOLUTION_CHANNEL_BADGE_ATTRIBUTE}]`,
  );
  if (readLuoguSolutionChannelState(root, pathname) !== true) {
    existing?.remove();
    return;
  }

  const tagsContainer = findLuoguTagsContainer(root);
  if (!tagsContainer) {
    existing?.remove();
    return;
  }
  if (existing?.parentElement === tagsContainer) {
    if (!existing.dataset.ojtraceFallbackTag) {
      const label =
        existing.tagName.toLowerCase() === "span"
          ? existing
          : existing.querySelector("span");
      if (label instanceof HTMLElement) applySolutionChannelTagColor(label);
      return;
    }
    const nativeBadge = cloneNativeLuoguTag(tagsContainer);
    if (nativeBadge) {
      existing.replaceWith(nativeBadge);
      return;
    }
    existing.remove();
  } else existing?.remove();

  const badge = cloneNativeLuoguTag(tagsContainer) ?? makeEmptyCardBadge();
  tagsContainer.append(badge);
}

/** Observe only the official state node; no page-wide DOM watching is needed. */
export function observeLuoguSolutionChannelChanges(
  onChange: () => void,
  root: ParentNode = document,
): () => void {
  const observers: MutationObserver[] = [];
  const context = root.querySelector<HTMLScriptElement>(
    'script#lentille-context[type="application/json"]',
  );
  if (context) {
    const contextObserver = new MutationObserver(() => onChange());
    contextObserver.observe(context, {
      characterData: true,
      childList: true,
    });
    observers.push(contextObserver);
  }

  return () => observers.forEach((observer) => observer.disconnect());
}
