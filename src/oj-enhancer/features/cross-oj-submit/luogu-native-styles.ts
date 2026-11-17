/** Reuse Luogu Columba CSS by copying Vue scoped attributes from loaded styles. */

const STYLE_LOAD_TIMEOUT_MS = 1_500;

export function scopedAttributes(
  element: Element | null | undefined,
): string[] {
  if (!element) return [];
  return [...element.attributes]
    .map((attribute) => attribute.name)
    .filter((name) => /^data-v-[\da-f]+(?:-s)?$/.test(name));
}

function cssRulesOf(sheet: CSSStyleSheet): string[] {
  const rules: string[] = [];
  const visit = (list: CSSRuleList): void => {
    for (const rule of list) {
      if (rule instanceof CSSStyleRule) rules.push(rule.selectorText);
      if ("cssRules" in rule) {
        try {
          visit((rule as CSSGroupingRule).cssRules);
        } catch {
          // A browser can expose a grouping rule but deny its nested rules.
        }
      }
    }
  };
  try {
    visit(sheet.cssRules);
  } catch {
    // Cross-origin sheets need an anonymous stylesheet link to expose CSSOM.
  }
  return rules;
}

export function attributesFromSelectors(
  selectors: readonly string[],
  marker: RegExp,
): string[] {
  const attributes = new Set<string>();
  for (const selector of selectors) {
    const match = marker.exec(selector);
    marker.lastIndex = 0;
    if (match?.[1]) attributes.add(`data-v-${match[1]}`);
  }
  return [...attributes];
}

export function allLuoguComponentStylesheets(): HTMLLinkElement[] {
  return [
    ...document.querySelectorAll<HTMLLinkElement>(
      'link[rel="stylesheet"][href]',
    ),
  ].filter((link) => {
    try {
      const url = new URL(link.href);
      return (
        url.origin !== location.origin &&
        url.pathname.startsWith("/columba/") &&
        url.pathname.endsWith(".css")
      );
    } catch {
      return false;
    }
  });
}

export function currentStylesheetSelectors(): string[] {
  return Array.from(document.styleSheets).flatMap(cssRulesOf);
}

export async function loadAnonymousStylesheetSelectors(
  urls: readonly string[],
): Promise<string[]> {
  if (!urls.length) return [];
  return new Promise((resolve) => {
    const temporaryLinks: HTMLLinkElement[] = [];
    const pending = new Set<HTMLLinkElement>();
    const selectors: string[] = [];
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      temporaryLinks.forEach((link) => link.remove());
      resolve(selectors);
    };
    const timeout = window.setTimeout(finish, STYLE_LOAD_TIMEOUT_MS);
    const checkFinished = (): void => {
      if (!settled && pending.size === 0) finish();
    };

    for (const href of urls) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.crossOrigin = "anonymous";
      link.media = "not all";
      temporaryLinks.push(link);
      pending.add(link);
      const onLoad = (): void => {
        if (link.sheet) selectors.push(...cssRulesOf(link.sheet));
        pending.delete(link);
        checkFinished();
      };
      const onError = (): void => {
        pending.delete(link);
        checkFinished();
      };
      link.addEventListener("load", onLoad, { once: true });
      link.addEventListener("error", onError, { once: true });
      document.head.append(link);
    }
  });
}
