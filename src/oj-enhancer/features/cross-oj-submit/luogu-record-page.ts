import type { CrossOjSubmissionDetail } from "./model";
import type { LuoguCrossOjRecordRoute } from "./record-details";
import {
  applyCurrentLuoguAvatar,
  applyCurrentLuoguUsername,
  currentLuoguUserUrl,
  displayDate,
  displayMemory,
  nativeLinkAttributes,
} from "./luogu-native-identity";
import {
  allLuoguComponentStylesheets,
  applyScope,
  attributesFromSelectors,
  currentStylesheetSelectors,
  installLuoguStylesheets,
  loadAnonymousStylesheetSelectors,
  luoguComponentSelectors,
  scopedAttributes,
} from "./luogu-native-styles";
import { markLuoguUserCardTrigger } from "./luogu-user-card";
import {
  LUOGU_CROSS_OJ_RECORD_PAGE_ATTRIBUTE,
  LUOGU_CROSS_OJ_RECORD_ROUTE_KEY_ATTRIBUTE,
  currentLuoguNavigationUrl,
  luoguCrossOjRecordRouteKey,
} from "./luogu-record-route";

const PAGE_ROOT_ATTRIBUTE = LUOGU_CROSS_OJ_RECORD_PAGE_ATTRIBUTE;
const ROUTE_KEY_ATTRIBUTE = LUOGU_CROSS_OJ_RECORD_ROUTE_KEY_ATTRIBUTE;
const RECORD_STYLE_ID = "ojtrace-luogu-record-style";
const RECORD_NODE_ATTRIBUTE = "data-ojtrace-luogu-record-node";
const RECORD_NODE_KIND_ATTRIBUTE = "data-ojtrace-luogu-record-node-kind";
const HIDDEN_NATIVE_ATTRIBUTE = "data-ojtrace-luogu-hidden-native";
const HIDDEN_NATIVE_HIDDEN_ATTRIBUTE =
  "data-ojtrace-luogu-hidden-native-original-hidden";
const HIDDEN_NATIVE_STYLE_ATTRIBUTE =
  "data-ojtrace-luogu-hidden-native-original-style";
const HIDDEN_NATIVE_ARIA_ATTRIBUTE =
  "data-ojtrace-luogu-hidden-native-original-aria";
const BREADCRUMB_ATTRIBUTE = "data-ojtrace-record-breadcrumb";
const NULL_ATTRIBUTE_VALUE = "__ojtrace-null__";

interface HiddenNativeState {
  hidden: boolean;
  style: string | null;
  ariaHidden: string | null;
}

interface RecordPageScopes {
  page: string[];
  card: string[];
  stat: string[];
  menu: string[];
  sidebar: string[];
  test: string[];
  link: string[];
}

let extraRecordCss: Promise<string[]> | undefined;
const hiddenNativeState = new Map<HTMLElement, HiddenNativeState>();
let breadcrumbSnapshot: { element: HTMLElement; html: string } | undefined;
let titleSnapshot: string | undefined;

function isDocumentUrlCurrent(expectedUrl: string): boolean {
  try {
    const expected = new URL(expectedUrl);
    return currentLuoguNavigationUrl() === expected.href;
  } catch {
    return false;
  }
}

function create(tag: string, className?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function apply(
  element: Element,
  ...scopeLists: Array<readonly string[] | undefined>
): void {
  for (const scopes of scopeLists) if (scopes) applyScope(element, scopes);
}

function verdictKind(
  verdict: string | undefined,
  evaluationStatus?: CrossOjSubmissionDetail["evaluationStatus"],
): "accepted" | "rejected" | "judging" | "unknown" {
  const value = verdict?.trim().toUpperCase() ?? "";
  if (
    evaluationStatus === "accepted" ||
    ["OK", "AC", "ACCEPTED"].includes(value)
  )
    return "accepted";
  if (
    evaluationStatus === "judging" ||
    ["TESTING", "WAITING", "WJ", "JUDGING"].includes(value)
  )
    return "judging";
  if (
    evaluationStatus === "rejected" ||
    [
      "WRONG_ANSWER",
      "WA",
      "TLE",
      "TIME_LIMIT_EXCEEDED",
      "MLE",
      "MEMORY_LIMIT_EXCEEDED",
      "OLE",
      "OUTPUT_LIMIT_EXCEEDED",
      "RE",
      "RUNTIME_ERROR",
      "CE",
      "COMPILATION_ERROR",
      "PE",
      "PRESENTATION_ERROR",
    ].includes(value)
  )
    return "rejected";
  return "unknown";
}

function statusLabel(detail: CrossOjSubmissionDetail): string {
  if (detail.evaluationStatus === "accepted") return "Accepted";
  const verdict = detail.rawVerdict?.trim().toUpperCase();
  const labels: Record<string, string> = {
    WRONG_ANSWER: "Wrong Answer",
    WA: "Wrong Answer",
    PRESENTATION_ERROR: "Presentation Error",
    PE: "Presentation Error",
    TIME_LIMIT_EXCEEDED: "Time Limit Exceeded",
    TLE: "Time Limit Exceeded",
    MEMORY_LIMIT_EXCEEDED: "Memory Limit Exceeded",
    MLE: "Memory Limit Exceeded",
    OUTPUT_LIMIT_EXCEEDED: "Output Limit Exceeded",
    OLE: "Output Limit Exceeded",
    COMPILATION_ERROR: "Compilation Error",
    CE: "Compilation Error",
    RUNTIME_ERROR: "Runtime Error",
    RE: "Runtime Error",
    TESTING: "Judging",
    WAITING: "Waiting",
    WJ: "Waiting",
  };
  if (verdict && labels[verdict]) return labels[verdict];
  if (detail.evaluationStatus === "rejected") return "Rejected";
  if (detail.evaluationStatus === "judging") return verdict || "Judging";
  return verdict || "Unknown";
}

function statusColorClass(kind: ReturnType<typeof verdictKind>): string {
  if (kind === "accepted") return "lcolor--green-3";
  if (kind === "rejected") return "lcolor--red-3";
  if (kind === "judging") return "lcolor--orange-3";
  return "lcolor--grey-3";
}

function testColorClass(kind: ReturnType<typeof verdictKind>): string {
  if (kind === "accepted") return "lcolor-bg-green-3";
  if (kind === "rejected") return "lcolor-bg-red-3";
  if (kind === "judging") return "lcolor-bg-yellow-3";
  return "lcolor-bg-grey-3";
}

function testLabel(test: CrossOjSubmissionDetail["tests"][number]): string {
  const verdict = test.verdict?.trim().toUpperCase();
  if (!verdict) return "—";
  if (["OK", "AC", "ACCEPTED"].includes(verdict)) return "AC";
  if (["WRONG_ANSWER", "WA"].includes(verdict)) return "WA";
  if (["TLE", "TIME_LIMIT_EXCEEDED"].includes(verdict)) return "TLE";
  if (["MLE", "MEMORY_LIMIT_EXCEEDED"].includes(verdict)) return "MLE";
  if (["OLE", "OUTPUT_LIMIT_EXCEEDED"].includes(verdict)) return "OLE";
  if (["RE", "RUNTIME_ERROR"].includes(verdict)) return "RE";
  if (["CE", "COMPILATION_ERROR"].includes(verdict)) return "CE";
  if (["PE", "PRESENTATION_ERROR"].includes(verdict)) return "PE";
  return test.verdict?.trim() || "—";
}

function problemId(detail: CrossOjSubmissionDetail): string {
  if (detail.oj === "codeforces") {
    const match = /^(\d+)\/([A-Za-z]\d*)$/.exec(detail.problemId);
    if (match?.[1] && match[2]) return `CF${match[1]}${match[2].toUpperCase()}`;
  } else if (/^[a-z0-9_-]+$/i.test(detail.problemId)) {
    return `AT_${detail.problemId}`;
  }
  return "";
}

function problemTitle(detail: CrossOjSubmissionDetail): string {
  return (
    detail.problemName?.replace(/^[A-Za-z][A-Za-z0-9_-]*\s+-\s*/, "") ||
    detail.problemName ||
    ""
  );
}

function submittedAt(detail: CrossOjSubmissionDetail): string {
  const parsed = detail.submittedAt
    ? Date.parse(detail.submittedAt)
    : detail.observedAt;
  return Number.isFinite(parsed) ? displayDate(parsed) : "—";
}

function scoreValue(detail: CrossOjSubmissionDetail): number | undefined {
  if (detail.evaluationStatus === "accepted" && detail.oj === "codeforces")
    return 100;
  if (detail.score !== undefined) return detail.score;
  return undefined;
}

function testMetric(test: CrossOjSubmissionDetail["tests"][number]): string {
  const time = test.timeMs !== undefined ? `${test.timeMs}ms` : "";
  const memory = displayMemory(test.memoryBytes) ?? "";
  return [time, memory].filter(Boolean).join("/") || "—";
}

function existingRecordNodes(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(`[${RECORD_NODE_ATTRIBUTE}]`),
  ];
}

function recordNodePair(route: LuoguCrossOjRecordRoute): {
  header: HTMLElement | undefined;
  main: HTMLElement | undefined;
  valid: boolean;
} {
  const routeKey = luoguCrossOjRecordRouteKey(route);
  const nodes = existingRecordNodes();
  const headers = nodes.filter(
    (node) =>
      node.getAttribute(RECORD_NODE_KIND_ATTRIBUTE) === "header" &&
      node.getAttribute(ROUTE_KEY_ATTRIBUTE) === routeKey,
  );
  const mains = nodes.filter(
    (node) =>
      node.getAttribute(RECORD_NODE_KIND_ATTRIBUTE) === "main" &&
      node.getAttribute(ROUTE_KEY_ATTRIBUTE) === routeKey,
  );
  const valid =
    nodes.length === 2 &&
    headers.length === 1 &&
    mains.length === 1 &&
    headers[0]?.parentElement === mains[0]?.parentElement;
  return { header: headers[0], main: mains[0], valid };
}

function themeHost(): HTMLElement | undefined {
  return (
    document.querySelector<HTMLElement>(".theme-page") ??
    document.querySelector<HTMLElement>("[class*='theme-page']") ??
    undefined
  );
}

function installRecordStyles(): void {
  if (document.getElementById(RECORD_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = RECORD_STYLE_ID;
  style.textContent = `
    .ojtrace-record-page [data-ojtrace-panel][hidden] { display: none !important; }
    .ojtrace-record-page .ojtrace-record-avatar { width: 35px !important; height: 35px !important; flex: 0 0 35px; object-fit: cover; border-radius: 50%; }
    .ojtrace-record-page .ojtrace-tab-button { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 0; }
    .ojtrace-record-page .ojtrace-source-code { max-width: 100%; overflow: auto; white-space: pre; }
    .ojtrace-record-page .ojtrace-record-layout-fallback { display: flex; flex-direction: row-reverse; align-items: flex-start; gap: 16px; }
    .ojtrace-record-page .ojtrace-record-layout-fallback > .side { flex: 1 1 0%; min-width: 0; }
    .ojtrace-record-page .ojtrace-record-layout-fallback > .main { flex: 2 1 0%; min-width: 0; }
    @media (max-width: 768px) {
      .ojtrace-record-page .ojtrace-record-layout-fallback { flex-direction: column; }
      .ojtrace-record-page .ojtrace-record-layout-fallback > .side,
      .ojtrace-record-page .ojtrace-record-layout-fallback > .main { width: 100%; }
    }
  `;
  document.head.append(style);
}

function restoreHiddenNativeContent(): void {
  const markedElements = new Set<HTMLElement>([
    ...hiddenNativeState.keys(),
    ...document.querySelectorAll<HTMLElement>(`[${HIDDEN_NATIVE_ATTRIBUTE}]`),
  ]);
  for (const element of markedElements) {
    const state = hiddenNativeState.get(element);
    if (element.isConnected) {
      const hidden =
        state?.hidden ??
        element.getAttribute(HIDDEN_NATIVE_HIDDEN_ATTRIBUTE) === "true";
      const style =
        state?.style ?? element.getAttribute(HIDDEN_NATIVE_STYLE_ATTRIBUTE);
      const ariaHidden =
        state?.ariaHidden ?? element.getAttribute(HIDDEN_NATIVE_ARIA_ATTRIBUTE);
      element.hidden = hidden;
      if (style === null || style === NULL_ATTRIBUTE_VALUE)
        element.removeAttribute("style");
      else element.setAttribute("style", style);
      if (ariaHidden === null || ariaHidden === NULL_ATTRIBUTE_VALUE)
        element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", ariaHidden);
    }
    element.removeAttribute(HIDDEN_NATIVE_ATTRIBUTE);
    element.removeAttribute(HIDDEN_NATIVE_HIDDEN_ATTRIBUTE);
    element.removeAttribute(HIDDEN_NATIVE_STYLE_ATTRIBUTE);
    element.removeAttribute(HIDDEN_NATIVE_ARIA_ATTRIBUTE);
  }
  hiddenNativeState.clear();
}

function hideNativeContent(host: HTMLElement): void {
  for (const child of Array.from(host.children)) {
    const element = child as HTMLElement;
    if (
      element.hasAttribute(RECORD_NODE_ATTRIBUTE) ||
      element.tagName.toLowerCase() === "footer"
    )
      continue;
    if (!hiddenNativeState.has(element)) {
      hiddenNativeState.set(element, {
        hidden: element.hidden === true,
        style: element.getAttribute("style"),
        ariaHidden: element.getAttribute("aria-hidden"),
      });
      element.setAttribute(
        HIDDEN_NATIVE_HIDDEN_ATTRIBUTE,
        element.hidden === true ? "true" : "false",
      );
      element.setAttribute(
        HIDDEN_NATIVE_STYLE_ATTRIBUTE,
        element.getAttribute("style") ?? NULL_ATTRIBUTE_VALUE,
      );
      element.setAttribute(
        HIDDEN_NATIVE_ARIA_ATTRIBUTE,
        element.getAttribute("aria-hidden") ?? NULL_ATTRIBUTE_VALUE,
      );
    }
    if (
      element.hidden === true &&
      element.getAttribute("aria-hidden") === "true" &&
      element.hasAttribute(HIDDEN_NATIVE_ATTRIBUTE)
    )
      continue;
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
    element.setAttribute(HIDDEN_NATIVE_ATTRIBUTE, "");
  }
}

function removeOwnedRecordNodes(): void {
  existingRecordNodes().forEach((node) => node.remove());
}

function copyAttributes(source: Element | null, target: Element): void {
  if (!source) return;
  for (const attribute of source.attributes)
    target.setAttribute(attribute.name, attribute.value);
}

function applyRecordBreadcrumb(route: LuoguCrossOjRecordRoute): void {
  const breadcrumb = document.querySelector<HTMLElement>(
    ".top-bar .breadcrumb",
  );
  if (!breadcrumb) return;
  if (!breadcrumbSnapshot || breadcrumbSnapshot.element !== breadcrumb)
    breadcrumbSnapshot = { element: breadcrumb, html: breadcrumb.innerHTML };
  const routeKey = luoguCrossOjRecordRouteKey(route);
  const currentHref = currentLuoguNavigationUrl();
  const existingCurrent = breadcrumb.querySelector<HTMLAnchorElement>(
    'a[aria-current="page"]',
  );
  if (
    breadcrumb.getAttribute(BREADCRUMB_ATTRIBUTE) === routeKey &&
    existingCurrent?.href === currentHref &&
    existingCurrent.textContent === `R${route.submissionId}`
  )
    return;
  const linkSource = breadcrumb.querySelector<HTMLAnchorElement>("a[href]");
  const separatorSource = breadcrumb.querySelector("span");
  const listLink = document.createElement("a");
  copyAttributes(linkSource, listLink);
  listLink.href = "/record/list";
  listLink.textContent = "评测记录";
  const separator = document.createElement("span");
  copyAttributes(separatorSource, separator);
  separator.textContent = "/";
  const current = document.createElement("a");
  copyAttributes(linkSource, current);
  current.href = currentHref;
  current.setAttribute("aria-current", "page");
  current.textContent = `R${route.submissionId}`;
  breadcrumb.replaceChildren(listLink, separator, current);
  breadcrumb.setAttribute(BREADCRUMB_ATTRIBUTE, routeKey);
}

function restoreBreadcrumb(): void {
  if (breadcrumbSnapshot?.element.isConnected)
    breadcrumbSnapshot.element.innerHTML = breadcrumbSnapshot.html;
  breadcrumbSnapshot?.element.removeAttribute(BREADCRUMB_ATTRIBUTE);
  breadcrumbSnapshot = undefined;
}

function applyRecordTitle(route: LuoguCrossOjRecordRoute): void {
  titleSnapshot ??= document.title;
  document.title = `R${route.submissionId} - 记录详情 - 洛谷`;
}

function restoreTitle(): void {
  if (titleSnapshot !== undefined) document.title = titleSnapshot;
  titleSnapshot = undefined;
}

function scopesFromSelectors(selectors: readonly string[]): RecordPageScopes {
  return {
    page: attributesFromSelectors(
      selectors,
      /\.user-row\[data-v-([\da-f]+)\]/i,
    ),
    card: attributesFromSelectors(selectors, /\.l-card\[data-v-([\da-f]+)\]/i),
    stat: attributesFromSelectors(selectors, /\.stat\[data-v-([\da-f]+)\]/i),
    menu: attributesFromSelectors(selectors, /\.menu\[data-v-([\da-f]+)\]/i),
    sidebar: attributesFromSelectors(
      selectors,
      /\.sidebar-container\[data-v-([\da-f]+)\]/i,
    ),
    test: attributesFromSelectors(
      selectors,
      /\.test-case\[data-v-([\da-f]+)\]/i,
    ),
    link: nativeLinkAttributes(),
  };
}

function hasRecordDetailCss(selectors: readonly string[]): boolean {
  return Boolean(
    attributesFromSelectors(selectors, /\.test-case\[data-v-([\da-f]+)\]/i)
      .length &&
    attributesFromSelectors(selectors, /\.user-row\[data-v-([\da-f]+)\]/i)
      .length,
  );
}

function columbaStylesheetUrls(html: string): string[] {
  const page = new DOMParser().parseFromString(html, "text/html");
  const urls: string[] = [];
  for (const link of page.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"][href]',
  )) {
    try {
      const url = new URL(link.getAttribute("href") ?? "", location.origin);
      if (
        url.protocol === "https:" &&
        url.hostname === "fecdn.luogu.com.cn" &&
        url.pathname.startsWith("/columba/") &&
        url.pathname.endsWith(".css")
      )
        urls.push(url.href);
    } catch {
      // Ignore non-Columba or malformed stylesheet URLs.
    }
  }
  return [...new Set(urls)];
}

function firstOwnRecordId(payload: unknown): string | undefined {
  const visit = (value: unknown, depth: number): string | undefined => {
    if (depth > 6 || !value || typeof value !== "object") return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (
      (typeof record.id === "number" || typeof record.id === "string") &&
      /^\d{1,12}$/.test(String(record.id)) &&
      record.problem
    )
      return String(record.id);
    for (const key of ["result", "records", "data", "currentData"]) {
      if (key in record) {
        const found = visit(record[key], depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(payload, 0);
}

function parseRecordListPayload(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const context = new DOMParser()
      .parseFromString(text, "text/html")
      .querySelector<HTMLScriptElement>(
        'script#lentille-context[type="application/json"]',
      )?.textContent;
    if (!context) return undefined;
    try {
      return JSON.parse(context) as unknown;
    } catch {
      return undefined;
    }
  }
}

async function discoverRecordDetailStylesheets(): Promise<string[]> {
  if (
    location.origin !== "https://www.luogu.com.cn" ||
    typeof fetch !== "function"
  )
    return [];
  const uid = /\/user\/(\d+)\/?$/.exec(currentLuoguUserUrl() ?? "")?.[1];
  if (!uid) return [];
  try {
    const listResponse = await fetch(
      `${location.origin}/record/list?user=${encodeURIComponent(uid)}&_contentOnly=1`,
      {
        credentials: "include",
        headers: { Accept: "application/json,text/html;q=0.9" },
      },
    );
    if (!listResponse.ok) return [];
    const recordId = firstOwnRecordId(
      parseRecordListPayload(await listResponse.text()),
    );
    if (!recordId) return [];
    const recordResponse = await fetch(
      `${location.origin}/record/${encodeURIComponent(recordId)}`,
      { credentials: "include", headers: { Accept: "text/html" } },
    );
    if (!recordResponse.ok) return [];
    const loaded = new Set(
      allLuoguComponentStylesheets().map((link) => link.href),
    );
    return columbaStylesheetUrls(await recordResponse.text()).filter(
      (href) => !loaded.has(href),
    );
  } catch {
    return [];
  }
}

async function recordPageSelectors(): Promise<string[]> {
  const loaded = await luoguComponentSelectors();
  if (hasRecordDetailCss(loaded)) return loaded;
  extraRecordCss ??= discoverRecordDetailStylesheets();
  const extra = await extraRecordCss;
  // A refresh can race the current user's record page or fail transiently.
  // Do not cache an empty discovery forever; a later repaint may have the
  // authenticated user context and can succeed.
  if (!extra.length) {
    extraRecordCss = undefined;
    return loaded;
  }
  installLuoguStylesheets(extra);
  const extraSelectors = await loadAnonymousStylesheetSelectors(extra);
  return [...loaded, ...currentStylesheetSelectors(), ...extraSelectors];
}

function addStatField(
  parent: HTMLElement,
  scopes: RecordPageScopes,
  label: string,
  value: string,
): void {
  const field = create("div", "field");
  apply(field, scopes.stat);
  const name = create("span", "stat-text name");
  apply(name, scopes.stat);
  name.textContent = label;
  const amount = create("span", "stat-text value");
  apply(amount, scopes.stat);
  amount.textContent = value;
  field.append(name, amount);
  parent.append(field);
}

function addInfoRow(
  parent: HTMLElement,
  scopes: RecordPageScopes,
  label: string,
  value: string | Node,
  valueClassName?: string,
): void {
  const row = create("div", "l-flex-info-row");
  apply(row, scopes.page);
  const key = create("span");
  apply(key, scopes.page);
  key.textContent = label;
  const content = create("span", valueClassName);
  apply(content, scopes.page);
  if (typeof value === "string") content.textContent = value;
  else content.append(value);
  row.append(key, content);
  parent.append(row);
}

function createUsername(scopes: RecordPageScopes): HTMLElement {
  const row = create("div", "user-row ojtrace-user-row");
  apply(row, scopes.page);
  const username = create("div", "luogu-username");
  apply(username, scopes.page);
  applyCurrentLuoguUsername(username);
  const avatar = document.createElement("img");
  if (
    applyCurrentLuoguAvatar(avatar, [
      ...scopes.page,
      ...scopedAttributes(username),
    ])
  ) {
    avatar.classList.add("ojtrace-record-avatar");
    username.prepend(avatar);
  }
  const link = username.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
  if (link) markLuoguUserCardTrigger(link);
  row.append(username);
  return row;
}

function createProblemValue(
  scopes: RecordPageScopes,
  detail: CrossOjSubmissionDetail,
): Node {
  const pid = problemId(detail);
  const title = problemTitle(detail);
  if (!pid) return document.createTextNode(title || detail.problemId);
  const wrap = create("span", "problem-row");
  apply(wrap, scopes.page);
  const link = document.createElement("a");
  link.href = `/problem/${encodeURIComponent(pid)}`;
  link.setAttribute("disabled", "false");
  apply(link, scopes.link, scopes.page);
  const strong = document.createElement("strong");
  strong.style.color = "var(--lfe-color--pink-3)";
  strong.textContent = pid;
  apply(strong, scopes.page);
  link.append(strong);
  if (title) link.append(document.createTextNode(` ${title}`));
  wrap.append(link);
  return wrap;
}

function addOriginalRecordLink(
  parent: HTMLElement,
  scopes: RecordPageScopes,
  detail: CrossOjSubmissionDetail,
): void {
  let url: URL;
  try {
    url = new URL(detail.detailUrl);
  } catch {
    return;
  }
  const origin =
    detail.oj === "codeforces"
      ? "https://codeforces.com"
      : "https://atcoder.jp";
  if (url.origin !== origin) return;
  const link = document.createElement("a");
  link.href = url.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `${detail.oj === "codeforces" ? "Codeforces" : "AtCoder"} 原始记录`;
  apply(link, scopes.link, scopes.page);
  addInfoRow(parent, scopes, "", link);
}

function createTestCase(
  scopes: RecordPageScopes,
  test: CrossOjSubmissionDetail["tests"][number],
): HTMLElement {
  const wrapper = create("div", "wrapper");
  apply(wrapper, scopes.test, scopes.page);
  const kind = verdictKind(test.verdict);
  const item = create("div", `test-case ${testColorClass(kind)}`);
  item.tabIndex = 0;
  apply(item, scopes.test);
  const content = create("div", "content");
  apply(content, scopes.test);
  const info = create("div", "info");
  apply(info, scopes.test);
  info.textContent = testMetric(test);
  const status = create("div", "status");
  apply(status, scopes.test);
  status.textContent = testLabel(test);
  content.append(info, status);
  const id = create("div", "id");
  apply(id, scopes.test);
  id.textContent = `#${test.index}`;
  item.append(content, id);
  wrapper.append(item);
  return wrapper;
}

function createTab(
  scopes: RecordPageScopes,
  label: string,
  selected: boolean,
): HTMLButtonElement {
  const item = create("li");
  apply(item, scopes.menu);
  const entry = document.createElement("button");
  entry.className = selected
    ? "selected entry ojtrace-tab-button"
    : "entry ojtrace-tab-button";
  apply(entry, scopes.menu);
  entry.type = "button";
  entry.setAttribute("role", "tab");
  entry.setAttribute("aria-selected", selected ? "true" : "false");
  entry.tabIndex = selected ? 0 : -1;
  entry.textContent = label;
  item.append(entry);
  return entry;
}

export function maintainLuoguCrossOjRecordPage(
  route: LuoguCrossOjRecordRoute,
): { needsRender: boolean } {
  const pair = recordNodePair(route);
  if (!pair.valid || !pair.header || !pair.main) return { needsRender: true };
  const page = pair.header;
  const main = pair.main;
  const host = themeHost();
  if (!host || page.parentElement !== host || main.parentElement !== host)
    return { needsRender: true };
  hideNativeContent(host);
  applyRecordBreadcrumb(route);
  applyRecordTitle(route);
  return { needsRender: !page.querySelector(".header-card") };
}

export function unmountLuoguCrossOjRecordPage(): void {
  removeOwnedRecordNodes();
  restoreHiddenNativeContent();
  restoreBreadcrumb();
  restoreTitle();
  if (!document.querySelector(`[${RECORD_NODE_ATTRIBUTE}]`))
    document.getElementById(RECORD_STYLE_ID)?.remove();
}

/** Render the cross-OJ record inside Luogu's current themed shell. */
export async function renderLuoguCrossOjRecordPage(
  route: LuoguCrossOjRecordRoute,
  detail: CrossOjSubmissionDetail,
  expectedUrl: string,
  canCommit: () => boolean = () => true,
): Promise<{ installed: boolean }> {
  if (
    !isDocumentUrlCurrent(expectedUrl) ||
    !canCommit() ||
    route.oj !== detail.oj ||
    route.submissionId !== detail.submissionId
  )
    return { installed: false };

  const host = themeHost();
  if (!host) return { installed: false };
  installRecordStyles();

  const selectors = await recordPageSelectors();
  if (!isDocumentUrlCurrent(expectedUrl) || !canCommit())
    return { installed: false };
  const scopes = scopesFromSelectors(selectors);
  const sidebarParent = scopes.sidebar.map((scope) =>
    scope.endsWith("-s") ? scope : `${scope}-s`,
  );
  const kind = verdictKind(detail.rawVerdict, detail.evaluationStatus);

  const header = create("header");
  apply(header, scopes.page);
  const headerLayout = create("div", "columba-content-wrap header-layout");
  const headerBlock = create("div", "header-block");
  const headerCard = create("div", "l-card header-card");
  apply(headerCard, scopes.card);

  const topRow = create("div", "top-row");
  const left = create("div", "left");
  const title = create("h2", "title lfe-h2");
  title.textContent = `R${detail.submissionId} 记录详情`;
  left.append(title);
  const right = create("div", "right");
  const stats = create("div", "stat stacked");
  apply(stats, scopes.stat);
  addStatField(stats, scopes, "编程语言", detail.language || "—");
  addStatField(
    stats,
    scopes,
    "代码长度",
    detail.sourceCode ? `${detail.sourceCode.length}B` : "—",
  );
  addStatField(
    stats,
    scopes,
    "用时",
    detail.timeMs === undefined ? "—" : `${detail.timeMs}ms`,
  );
  addStatField(stats, scopes, "内存", displayMemory(detail.memoryBytes) ?? "—");
  right.append(stats);
  topRow.append(left, right);

  const bottomRow = create("div", "bottom-row");
  const menuWrap = create("div", "left");
  const menu = create("div", "menu");
  menu.style.setProperty("--main-color", "rgb(var(--lcolor--primary))");
  apply(menu, scopes.menu, scopes.page);
  const items = create("ul", "items");
  apply(items, scopes.menu);
  const resultTab = createTab(scopes, "评测信息", true);
  const sourceTab = createTab(scopes, "源代码", false);
  items.append(resultTab.parentElement!, sourceTab.parentElement!);
  menu.append(items);
  menuWrap.append(menu);
  bottomRow.append(menuWrap);
  headerCard.append(topRow, bottomRow);
  headerBlock.append(headerCard);
  headerLayout.append(headerBlock);
  header.append(headerLayout);

  const main = create("main");
  apply(main, scopes.page);
  const mainContent = create("div", "columba-content-wrap main-content");
  const columns = create(
    "div",
    `sidebar-container reverse${scopes.sidebar.length ? "" : " ojtrace-record-layout-fallback"}`,
  );
  apply(columns, scopes.sidebar, scopes.page);
  const side = create("div", "side");
  apply(side, scopes.sidebar);
  side.style.flex = "1 1 0%";
  const recordCard = create("div", "l-card");
  apply(recordCard, scopes.card, scopes.page, sidebarParent);
  recordCard.append(createUsername(scopes));
  addInfoRow(
    recordCard,
    scopes,
    "所属题目",
    createProblemValue(scopes, detail),
    "problem-row",
  );
  const verdict = create("span", statusColorClass(kind));
  verdict.style.fontWeight = "bold";
  verdict.textContent = statusLabel(detail);
  apply(verdict, scopes.page);
  addInfoRow(recordCard, scopes, "评测状态", verdict);
  const score = scoreValue(detail);
  if (score !== undefined) {
    const scoreNode = create("span", statusColorClass(kind));
    scoreNode.style.fontWeight = "bold";
    scoreNode.textContent = String(score);
    apply(scoreNode, scopes.page);
    addInfoRow(recordCard, scopes, "评测分数", scoreNode);
  }
  addInfoRow(recordCard, scopes, "提交时间", submittedAt(detail) || "—");
  addOriginalRecordLink(recordCard, scopes, detail);
  side.append(recordCard);

  const content = create("div", "main");
  apply(content, scopes.sidebar);
  content.style.flex = "2 1 0%";
  const resultCard = create("div", "l-card");
  apply(resultCard, scopes.card, scopes.page, sidebarParent);
  const resultSection = create("section", "tab-content");
  apply(resultSection, scopes.page);
  const testsHeading = create("h3", "lfe-h3");
  apply(testsHeading, scopes.page);
  testsHeading.textContent = "测试点信息";
  const tests = create("div", "test-case-wrap");
  apply(tests, scopes.page);
  if (detail.tests.length) {
    detail.tests.forEach((test) => tests.append(createTestCase(scopes, test)));
  } else {
    const empty = create("div", "lfe-caption");
    apply(empty, scopes.page);
    empty.textContent = "原站未提供测试点详情；记录摘要仍可查看。";
    tests.append(empty);
  }
  resultSection.append(testsHeading, tests);
  resultCard.append(resultSection);

  const sourceCard = create("div", "l-card ojtrace-source-card");
  apply(sourceCard, scopes.card, scopes.page, sidebarParent);
  sourceCard.setAttribute("data-ojtrace-panel", "source");
  sourceCard.hidden = true;
  sourceCard.style.display = "none";
  const sourceSection = create("section", "tab-content");
  apply(sourceSection, scopes.page);
  const sourceHeading = create("h3", "lfe-h3");
  apply(sourceHeading, scopes.page);
  sourceHeading.textContent = "源代码";
  const source = create("pre", "compile-info ojtrace-source-code");
  apply(source, scopes.page);
  source.textContent =
    detail.sourceCode || "本机未保存这条记录的源码。可前往原站查看。";
  sourceSection.append(sourceHeading, source);
  sourceCard.append(sourceSection);
  content.append(resultCard, sourceCard);
  columns.append(side, content);
  mainContent.append(columns);
  main.append(mainContent);

  resultCard.setAttribute("data-ojtrace-panel", "evaluation");
  const selectTab = (sourceSelected: boolean): void => {
    resultTab.className = sourceSelected
      ? "entry ojtrace-tab-button"
      : "selected entry ojtrace-tab-button";
    sourceTab.className = sourceSelected
      ? "selected entry ojtrace-tab-button"
      : "entry ojtrace-tab-button";
    resultTab.setAttribute("aria-selected", sourceSelected ? "false" : "true");
    sourceTab.setAttribute("aria-selected", sourceSelected ? "true" : "false");
    resultTab.tabIndex = sourceSelected ? -1 : 0;
    sourceTab.tabIndex = sourceSelected ? 0 : -1;
    resultCard.hidden = sourceSelected;
    sourceCard.hidden = !sourceSelected;
    resultCard.style.display = sourceSelected ? "none" : "";
    sourceCard.style.display = sourceSelected ? "" : "none";
  };
  resultTab.addEventListener("click", () => selectTab(false));
  sourceTab.addEventListener("click", () => selectTab(true));
  resultTab.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      sourceTab.focus();
      selectTab(true);
    }
  });
  sourceTab.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      resultTab.focus();
      selectTab(false);
    }
  });
  selectTab(false);

  const routeKey = luoguCrossOjRecordRouteKey(route);
  for (const [node, kind] of [
    [header, "header"],
    [main, "main"],
  ] as const) {
    node.setAttribute(RECORD_NODE_ATTRIBUTE, "");
    node.setAttribute(RECORD_NODE_KIND_ATTRIBUTE, kind);
    node.setAttribute(PAGE_ROOT_ATTRIBUTE, "");
    node.setAttribute(ROUTE_KEY_ATTRIBUTE, routeKey);
    node.classList.add("ojtrace-record-page");
  }
  // The detail request and stylesheet discovery are asynchronous.  A second
  // controller can finish while the first one is waiting, so make the final
  // DOM commit a single ownership boundary: stale controllers cannot commit,
  // and the winning controller removes any stale pair immediately before it
  // inserts its own pair.
  if (!isDocumentUrlCurrent(expectedUrl) || !canCommit())
    return { installed: false };
  removeOwnedRecordNodes();
  restoreHiddenNativeContent();
  const currentHost = themeHost();
  if (!currentHost) return { installed: false };
  currentHost.prepend(main);
  currentHost.prepend(header);
  hideNativeContent(currentHost);
  applyRecordBreadcrumb(route);
  applyRecordTitle(route);
  return { installed: true };
}
