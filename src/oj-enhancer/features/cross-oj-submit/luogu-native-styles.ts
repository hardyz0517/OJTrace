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

export function applyScope(target: Element, scopes: readonly string[]): void {
  for (const attribute of scopes) target.setAttribute(attribute, "");
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

export function installLuoguStylesheets(
  urls: readonly string[],
): HTMLLinkElement[] {
  const installed: HTMLLinkElement[] = [];
  const existing = new Set(
    [
      ...document.querySelectorAll<HTMLLinkElement>(
        'link[rel="stylesheet"][href]',
      ),
    ].map((link) => link.href),
  );
  for (const href of urls) {
    if (existing.has(href)) continue;
    try {
      const url = new URL(href);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "fecdn.luogu.com.cn" ||
        !url.pathname.startsWith("/columba/") ||
        !url.pathname.endsWith(".css")
      )
        continue;
    } catch {
      continue;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
    existing.add(href);
    installed.push(link);
  }
  return installed;
}

export async function luoguComponentSelectors(): Promise<string[]> {
  const loaded = currentStylesheetSelectors();
  const urls = [
    ...new Set(allLuoguComponentStylesheets().map((link) => link.href)),
  ];
  if (!urls.length) return loaded;
  const extra = await loadAnonymousStylesheetSelectors(urls);
  return [...loaded, ...extra];
}
