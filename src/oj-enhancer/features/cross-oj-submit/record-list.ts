import type {
  CrossOjProblemRef,
  CrossOjRecordListItem,
  CrossOjResponse,
} from "./model";
import {
  markLuoguUserCardTrigger,
  mountLuoguUserCard,
} from "./luogu-user-card";
import {
  applyCurrentLuoguAvatar,
  applyCurrentLuoguUsername,
  displayDate,
  displayMemory,
  nativeLinkAttributes,
  updateNativeTemplateUsername,
} from "./luogu-native-identity";
import {
  attributesFromSelectors,
  currentStylesheetSelectors,
  loadAnonymousStylesheetSelectors,
  allLuoguComponentStylesheets,
  scopedAttributes,
} from "./luogu-native-styles";
import { buildLuoguCrossOjRecordUrl } from "./record-details";
import { adoptLuoguCrossOjRecordUrl } from "./luogu-record-route";
import clockIconSource from "./assets/record-clock.svg?raw";
import databaseIconSource from "./assets/record-database.svg?raw";
import fileCodeIconSource from "./assets/record-file-code.svg?raw";
import rulerIconSource from "./assets/record-ruler.svg?raw";

const CROSS_OJ_ROWS_ATTRIBUTE = "data-ojtrace-cross-oj-rows";
const CROSS_OJ_LIST_ATTRIBUTE = "data-ojtrace-luogu-record-list";
const STATUS_MESSAGE_ATTRIBUTE = "data-ojtrace-cross-oj-message";
let loadedRecordScopes: Promise<NativeRecordScopes | undefined> | undefined;

function fallbackRecordScopes(): Promise<NativeRecordScopes | undefined> {
  loadedRecordScopes ??= scopesFromLoadedStylesheets().then((scopes) => {
    if (!scopes) loadedRecordScopes = undefined;
    return scopes;
  });
  return loadedRecordScopes;
}

interface NativeRecordScopes {
  list: string[];
  record: string[];
  cell: string[];
  detail: string[];
}

function scopesFromNativeRows(
  list: HTMLElement,
): NativeRecordScopes | undefined {
  const row = list.querySelector<HTMLElement>(".list-wrap > .row-wrap > .row");
  if (!row) return undefined;
  const cells = [...row.children];
  const details = row.querySelector<HTMLElement>(".detail");
  return {
    list: scopedAttributes(list.querySelector(".list-wrap")),
    record: scopedAttributes(row),
    cell: scopedAttributes(cells[0]),
    detail: scopedAttributes(details),
  };
}

function scopeCandidatesFromRules(
  selectors: readonly string[],
): NativeRecordScopes | undefined {
  const list = attributesFromSelectors(
    selectors,
    /\.list-wrap\.table\[data-v-([\da-f]+)\]/i,
  );
  const record = attributesFromSelectors(
    selectors,
    /\.row-wrap\b[^,]*?\s*>\s*\.row\[data-v-([\da-f]+)\]/i,
  );
  const parentScopes = attributesFromSelectors(
    selectors,
    /\.row-wrap\b[^,]*?\s*>\s*\.row[^,]*?\s*>\s*\[data-v-([\da-f]+)-s\]/i,
  );
  const listScope = list.find((scope) => record.includes(scope));
  if (!listScope) return undefined;

  const componentScopes = ["user", "status", "problem", "detail"].map(
    (component) =>
      attributesFromSelectors(
        selectors,
        new RegExp(`\\.${component}\\[data-v-([\\da-f]+)\\]`, "i"),
      ),
  );
  const componentScope = componentScopes[0]?.find((scope) =>
    componentScopes.every((scopes) => scopes.includes(scope)),
  );
  if (!componentScope) return undefined;

  if (!parentScopes.includes(listScope)) return undefined;
  const parentScope = `${listScope}-s`;
  return {
    list: [listScope],
    record: [listScope],
    cell: [componentScope, parentScope],
    detail: [componentScope, parentScope],
  };
}

async function scopesFromLoadedStylesheets(): Promise<
  NativeRecordScopes | undefined
> {
  const urls = [
    ...new Set(allLuoguComponentStylesheets().map((link) => link.href)),
  ];
  const loadedScopes = scopeCandidatesFromRules(currentStylesheetSelectors());
  if (loadedScopes) return loadedScopes;
  if (!urls.length) return undefined;
  const selectors = await loadAnonymousStylesheetSelectors(urls);
  return scopeCandidatesFromRules(selectors);
}

function findContent():
  | {
      filterCard: HTMLElement;
      resultCard: HTMLElement;
      result: HTMLElement;
    }
  | undefined {
  const content = document.querySelector<HTMLElement>(
    ".main-container .main-content",
  );
  if (!content) return undefined;
  const cards = [...content.querySelectorAll<HTMLElement>(":scope > .l-card")];
  const filterCard = cards.find((card) => card.querySelector(".result"));
  const result = filterCard?.querySelector<HTMLElement>(".result");
  const resultCard = filterCard
    ? cards.find((card) => card !== filterCard)
    : undefined;
  if (!filterCard || !resultCard || !result) return undefined;
  return { filterCard, resultCard, result };
}

function createCell(
  scopes: readonly string[],
  className?: string,
): HTMLDivElement {
  const cell = document.createElement("div");
  for (const attribute of scopes) cell.setAttribute(attribute, "");
  if (className) cell.className = className;
  return cell;
}

function nativeUsername(scopes: NativeRecordScopes): HTMLElement {
  const component = document.createElement("div");
  component.className = "luogu-username";
  for (const attribute of scopes.cell) component.setAttribute(attribute, "");
  applyCurrentLuoguUsername(component);
  const link = component.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
  if (link) markLuoguUserCardTrigger(link);
  for (const attribute of scopes.cell) component.setAttribute(attribute, "");
  return component;
}

function applyNativeStatusBadge(
  element: HTMLElement,
  colorClass: string,
): void {
  const colorToken = colorClass.replace(/^lcolor--/, "--lfe-color--");
  element.className = colorClass;
  element.style.fontWeight = "bold";
  element.style.backgroundColor = `var(${colorToken})`;
  element.style.display = "inline-block";
  element.style.padding = "0 0.5em";
  element.style.borderRadius = "2px";
  const nativeButton = document.querySelector<HTMLElement>(
    ".result button, .l-button-primary, .l-button",
  );
  if (nativeButton) element.style.color = getComputedStyle(nativeButton).color;
}

function displayScore(record: CrossOjRecordListItem): number | undefined {
  if (record.evaluationStatus === "accepted" && record.oj === "codeforces")
    return 100;
  if (record.oj === "atcoder") return record.score;
  return record.score !== undefined && record.score > 1
    ? record.score
    : undefined;
}

function statusLabel(record: CrossOjRecordListItem): {
  label: string;
  colorClass: string;
} {
  if (record.evaluationStatus === "accepted")
    return { label: "Accepted", colorClass: "lcolor--green-3" };
  if (record.evaluationStatus === "judging")
    return { label: "Judging", colorClass: "lcolor--orange-3" };
  if (record.evaluationStatus === "rejected")
    return { label: "Rejected", colorClass: "lcolor--red-3" };
  return { label: "Unknown", colorClass: "lcolor--grey-3" };
}

function bindRecordDetailLink(link: HTMLAnchorElement): void {
  if (link.dataset.ojtraceRecordNav === "1") return;
  link.dataset.ojtraceRecordNav = "1";
  link.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      if (link.target && link.target !== "_self") return;
      if (!adoptLuoguCrossOjRecordUrl(link.href)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}

function detailHref(record: CrossOjRecordListItem): string {
  let contestId: string | undefined;
  if (record.oj === "codeforces") {
    contestId = /^(\d{1,10})\/[A-Z]\d*$/i.exec(record.problemId)?.[1];
  } else {
    contestId =
      /^https:\/\/atcoder\.jp\/contests\/([a-z0-9-]+)\/submissions\/\d+\/?$/i.exec(
        record.detailUrl,
      )?.[1];
  }
  return contestId
    ? (buildLuoguCrossOjRecordUrl(
        record.oj,
        contestId,
        record.submissionId,
        record.problemId,
        location.href,
      ) ?? "#")
    : "#";
}

function recordKey(record: CrossOjRecordListItem): string {
  return `${record.oj}:${record.problemId}:${record.submissionId}`;
}

function recordDomId(record: CrossOjRecordListItem): string {
  return `${record.oj}:${record.submissionId}`;
}

function luoguProblemId(
  problem: CrossOjProblemRef,
  explicitProblemId?: string,
): string {
  if (explicitProblemId && /^[A-Za-z0-9_-]+$/.test(explicitProblemId))
    return explicitProblemId;
  return problem.oj === "codeforces"
    ? `CF${problem.contestId}${problem.index}`
    : `AT_${problem.taskId}`;
}

function luoguProblemHref(problemId: string): string {
  return new URL(`/problem/${encodeURIComponent(problemId)}`, location.origin)
    .href;
}

function displayedProblemName(
  record: CrossOjRecordListItem,
): string | undefined {
  const name = record.problemName?.trim();
  if (!name || record.oj !== "codeforces") return name || undefined;
  const index = /\/([A-Z]\d*)$/i.exec(record.problemId)?.[1];
  if (!index) return name;
  return name.replace(new RegExp(`^${index}\\s*[-–—:]\\s*`, "i"), "");
}

function nativeIcon(
  template: HTMLElement | undefined,
  selector: string,
  fallbackSource: string,
  iconName: string,
  scopes: readonly string[],
): SVGSVGElement | undefined {
  const source = template?.querySelector<SVGSVGElement>(selector);
  let icon: SVGSVGElement | undefined;
  if (source) icon = source.cloneNode(true) as SVGSVGElement;
  else {
    const parsed = new DOMParser().parseFromString(
      fallbackSource,
      "image/svg+xml",
    );
    if (parsed.documentElement.localName === "svg")
      icon = document.importNode(
        parsed.documentElement,
        true,
      ) as unknown as SVGSVGElement;
  }
  if (!icon) return undefined;
  icon.classList.add("svg-inline--fa", `fa-${iconName}`);
  icon.setAttribute("data-prefix", "far");
  icon.setAttribute("data-icon", iconName);
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-hidden", "true");
  for (const attribute of scopes) icon.setAttribute(attribute, "");
  return icon;
}

function nativeMetricGroup(
  scopes: readonly string[],
  templateGroup?: Element | null,
): HTMLSpanElement {
  const group = document.createElement("span");
  for (const attribute of scopes) group.setAttribute(attribute, "");
  for (const attribute of scopedAttributes(templateGroup))
    group.setAttribute(attribute, "");
  return group;
}

function appendNativeMetric(
  group: HTMLElement,
  icon: SVGSVGElement | undefined,
  value: string,
): void {
  if (icon) group.append(icon, document.createTextNode(` ${value}`));
}

function renderNativeMetrics(
  detail: HTMLElement,
  record: CrossOjRecordListItem,
  scopes: readonly string[],
  template?: HTMLElement,
): void {
  const metrics = document.createElement("div");
  metrics.className = "metrics";
  for (const attribute of scopes) metrics.setAttribute(attribute, "");
  for (const attribute of scopedAttributes(template?.querySelector(".metrics")))
    metrics.setAttribute(attribute, "");

  const templateGroups = template?.querySelectorAll(".metrics > span");
  const measures = nativeMetricGroup(scopes, templateGroups?.[0]);
  const hasTime = record.timeMs !== undefined;
  const hasMemory = record.memoryBytes !== undefined;
  if (hasTime) {
    appendNativeMetric(
      measures,
      nativeIcon(
        template,
        ".metrics .fa-clock",
        clockIconSource,
        "clock",
        scopes,
      ),
      `${record.timeMs}ms`,
    );
  }
  if (hasTime && hasMemory)
    measures.append(document.createTextNode("\u00a0/\u00a0"));
  if (hasMemory) {
    appendNativeMetric(
      measures,
      nativeIcon(
        template,
        ".metrics .fa-database",
        databaseIconSource,
        "database",
        scopes,
      ),
      displayMemory(record.memoryBytes)!,
    );
  }
  if (hasTime || hasMemory) metrics.append(measures);

  if (record.codeLength !== undefined) {
    const codeLength = nativeMetricGroup(scopes, templateGroups?.[1]);
    appendNativeMetric(
      codeLength,
      nativeIcon(
        template,
        ".metrics .fa-ruler-combined",
        rulerIconSource,
        "ruler-combined",
        scopes,
      ),
      `${record.codeLength}B`,
    );
    metrics.append(codeLength);
  }
  detail.append(metrics);

  if (!record.language) return;
  const language = document.createElement("div");
  for (const attribute of scopes) language.setAttribute(attribute, "");
  const templateLanguage = template?.querySelector(
    ".detail > div:not(.metrics)",
  );
  for (const attribute of scopedAttributes(templateLanguage))
    language.setAttribute(attribute, "");
  const icon = nativeIcon(
    template,
    ".detail .fa-file-code",
    fileCodeIconSource,
    "file-code",
    scopes,
  );
  if (icon)
    language.append(icon, document.createTextNode(` ${record.language}`));
  else language.textContent = record.language;
  detail.append(language);
}

function renderFromNativeTemplate(
  record: CrossOjRecordListItem,
  template: HTMLElement,
  problemId: string,
): HTMLDivElement | undefined {
  const row = template.cloneNode(true) as HTMLDivElement;
  const username = row.querySelector<HTMLElement>(".user-info .luogu-username");
  const submittedAt = row.querySelector<HTMLElement>(".user-info .lfe-caption");
  const user = row.querySelector<HTMLElement>(".user");
  const statusLink = row.querySelector<HTMLAnchorElement>("a.status");
  const problemCell = row.querySelector<HTMLElement>(".problem");
  const detail = row.querySelector<HTMLElement>(".detail");
  if (
    !username ||
    !submittedAt ||
    !user ||
    !statusLink ||
    !problemCell ||
    !detail
  )
    return undefined;

  row.setAttribute("data-ojtrace-cross-oj-record", "");
  row.setAttribute("data-ojtrace-record-id", recordDomId(record));
  row.setAttribute("data-ojtrace-record-key", recordKey(record));
  // Keep the native link DOM, but display the logged-in Luogu account.
  updateNativeTemplateUsername(username);
  const usernameLink =
    username.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
  if (usernameLink) markLuoguUserCardTrigger(usernameLink);
  let avatar = user.querySelector<HTMLImageElement>("img.avatar");
  if (!avatar) {
    avatar = document.createElement("img");
    user.prepend(avatar);
  }
  if (!applyCurrentLuoguAvatar(avatar, scopedAttributes(user))) avatar.remove();
  submittedAt.textContent = displayDate(record.observedAt);

  statusLink.href = detailHref(record);
  statusLink.removeAttribute("target");
  bindRecordDetailLink(statusLink);
  statusLink.replaceChildren();
  const status = statusLabel(record);
  const statusText = document.createElement("span");
  applyNativeStatusBadge(statusText, status.colorClass);
  statusText.textContent = status.label;
  for (const attribute of scopedAttributes(
    template.querySelector(".status span"),
  ))
    statusText.setAttribute(attribute, "");
  statusLink.append(statusText);
  const scoreValue = displayScore(record);
  if (scoreValue !== undefined) {
    const score = document.createElement("span");
    score.className =
      record.evaluationStatus === "accepted"
        ? "lcolor--green-3"
        : "lcolor--orange-3";
    score.style.fontWeight = "bold";
    score.textContent = String(scoreValue);
    for (const attribute of scopedAttributes(
      template.querySelector(".status span"),
    ))
      score.setAttribute(attribute, "");
    statusLink.append(score);
  }

  const problemLink =
    problemCell.querySelector<HTMLAnchorElement>("a") ??
    document.createElement("a");
  if (!scopedAttributes(problemLink).length) {
    for (const attribute of scopedAttributes(problemCell))
      problemLink.setAttribute(attribute, "");
  }
  problemLink.href = luoguProblemHref(problemId);
  problemLink.removeAttribute("target");
  problemLink.removeAttribute("rel");
  const problemName =
    (template.querySelector<HTMLElement>(".problem strong")?.cloneNode(true) as
      HTMLElement | undefined) ?? document.createElement("strong");
  problemName.textContent = problemId;
  if (!problemName.style.color)
    problemName.style.color = "var(--lfe-color--pink-3)";
  problemLink.replaceChildren(problemName);
  const title = displayedProblemName(record);
  if (title) problemLink.append(document.createTextNode(` ${title}`));
  problemCell.replaceChildren(problemLink);

  detail.replaceChildren();
  renderNativeMetrics(detail, record, scopedAttributes(detail), template);
  return row;
}

function renderRecord(
  record: CrossOjRecordListItem,
  scopes: NativeRecordScopes,
  problem: CrossOjProblemRef,
  explicitProblemId?: string,
  template?: HTMLElement,
): HTMLDivElement {
  if (template) {
    const nativeRow = renderFromNativeTemplate(
      record,
      template,
      luoguProblemId(problem, explicitProblemId),
    );
    if (nativeRow) return nativeRow;
  }
  const row = document.createElement("div");
  row.className = "row";
  row.setAttribute("data-ojtrace-cross-oj-record", "");
  row.setAttribute("data-ojtrace-record-id", recordDomId(record));
  row.setAttribute("data-ojtrace-record-key", recordKey(record));
  for (const attribute of scopes.record) row.setAttribute(attribute, "");

  const userCell = createCell(scopes.cell);
  const user = createCell(scopes.cell, "user");
  const userInfo = createCell(scopes.cell, "user-info");
  const avatar = document.createElement("img");
  if (applyCurrentLuoguAvatar(avatar, scopes.cell)) user.append(avatar);
  userInfo.append(nativeUsername(scopes));
  const submittedAt = document.createElement("span");
  submittedAt.className = "lfe-caption";
  submittedAt.textContent = displayDate(record.observedAt);
  for (const attribute of scopes.cell) submittedAt.setAttribute(attribute, "");
  userInfo.append(submittedAt);
  user.append(userInfo);
  userCell.append(user);

  const statusCell = createCell(scopes.cell);
  const statusLink = document.createElement("a");
  statusLink.className = "status";
  statusLink.href = detailHref(record);
  bindRecordDetailLink(statusLink);
  for (const attribute of scopes.cell) statusLink.setAttribute(attribute, "");
  const status = statusLabel(record);
  const statusText = document.createElement("span");
  applyNativeStatusBadge(statusText, status.colorClass);
  statusText.textContent = status.label;
  for (const attribute of scopes.cell) statusText.setAttribute(attribute, "");
  statusLink.append(statusText);
  const scoreValue = displayScore(record);
  if (scoreValue !== undefined) {
    const score = document.createElement("span");
    score.className =
      record.evaluationStatus === "accepted"
        ? "lcolor--green-3"
        : "lcolor--orange-3";
    score.style.fontWeight = "bold";
    score.textContent = String(scoreValue);
    for (const attribute of scopes.cell) score.setAttribute(attribute, "");
    statusLink.append(score);
  }
  statusCell.append(statusLink);

  const problemCell = createCell(scopes.cell, "problem");
  const problemLink = document.createElement("a");
  const officialProblemId = luoguProblemId(problem, explicitProblemId);
  problemLink.className = "";
  problemLink.setAttribute("disabled", "false");
  problemLink.href = luoguProblemHref(officialProblemId);
  for (const attribute of nativeLinkAttributes())
    problemLink.setAttribute(attribute, "");
  for (const attribute of scopes.cell) problemLink.setAttribute(attribute, "");
  const problemName = document.createElement("strong");
  problemName.style.color = "var(--lfe-color--pink-3)";
  problemName.textContent = officialProblemId;
  for (const attribute of scopes.cell) problemName.setAttribute(attribute, "");
  problemLink.append(problemName);
  const title = displayedProblemName(record);
  if (title) {
    problemLink.append(document.createTextNode(` ${title}`));
  }
  problemCell.append(problemLink);

  const metaCell = createCell(scopes.cell);
  const detail = createCell(scopes.detail, "detail lfe-caption");
  renderNativeMetrics(detail, record, scopes.detail);
  metaCell.append(detail);

  row.append(userCell, statusCell, problemCell, metaCell);
  return row;
}

function makeGeneratedList(
  scopes: NativeRecordScopes,
  records: readonly CrossOjRecordListItem[],
  problem: CrossOjProblemRef,
  explicitProblemId?: string,
  template?: HTMLElement,
): HTMLElement {
  const list = document.createElement("div");
  list.className = "list";
  list.style.width = "100%";
  list.style.minWidth = "0";
  list.style.maxWidth = "100%";
  list.setAttribute(CROSS_OJ_ROWS_ATTRIBUTE, "");
  list.setAttribute(CROSS_OJ_LIST_ATTRIBUTE, "");
  for (const attribute of scopes.list) list.setAttribute(attribute, "");
  const scroll = document.createElement("div");
  scroll.className = "list-scroll overflow";
  scroll.style.minWidth = "0";
  scroll.style.maxWidth = "100%";
  scroll.style.overflowX = "auto";
  for (const attribute of scopes.list) scroll.setAttribute(attribute, "");
  const table = document.createElement("div");
  table.className = "list-wrap table border";
  table.style.width = "100%";
  table.style.maxWidth = "100%";
  for (const attribute of scopes.list) table.setAttribute(attribute, "");
  const rows = document.createElement("div");
  rows.className = "row-wrap";
  for (const attribute of scopes.record) rows.setAttribute(attribute, "");
  for (const record of records)
    rows.append(
      renderRecord(record, scopes, problem, explicitProblemId, template),
    );
  table.append(rows);
  scroll.append(table);
  list.append(scroll);
  return list;
}

function attachStatusMessage(result: HTMLElement, message: HTMLElement): void {
  const count = result.querySelector(".count");
  const hideDifficulty = [...result.querySelectorAll("a, button, span")].find(
    (element) =>
      /^(隐藏难度|显示难度)$/.test((element.textContent ?? "").trim()),
  );
  if (hideDifficulty && hideDifficulty.parentElement !== result) {
    if (message.previousElementSibling !== hideDifficulty)
      hideDifficulty.after(message);
    return;
  }
  if (count) {
    if (message.parentElement !== count) count.append(message);
    return;
  }

  const search = result.querySelector(":scope > button, :scope > .l-button");
  if (search) {
    if (message.nextElementSibling !== search) search.before(message);
    return;
  }
  if (message.parentElement !== result) result.prepend(message);
}

function setMessage(result: HTMLElement, text?: string): void {
  const current = result.querySelector<HTMLElement>(
    `[${STATUS_MESSAGE_ATTRIBUTE}]`,
  );
  if (!text) {
    current?.remove();
    return;
  }
  const message = current ?? document.createElement("span");
  if (!current) {
    message.className = "lfe-caption";
    message.setAttribute(STATUS_MESSAGE_ATTRIBUTE, "");
    message.style.marginLeft = "0.75em";
  }
  if (message.textContent !== text) message.textContent = text;
  attachStatusMessage(result, message);
}

function updateResultCount(result: HTMLElement, count: number): void {
  const number = result.querySelector<HTMLElement>(".count .number");
  if (!number) return;
  if (number.getAttribute("data-ojtrace-original-count") === null) {
    number.setAttribute(
      "data-ojtrace-original-count",
      number.textContent?.trim() ?? "0",
    );
  }
  const originalCount = Number(
    number.getAttribute("data-ojtrace-original-count") ?? "0",
  );
  const nextCount = String(originalCount + count);
  if (number.textContent !== nextCount) number.textContent = nextCount;
}

function restoreResultCount(result: HTMLElement): void {
  const number = result.querySelector<HTMLElement>(".count .number");
  const original = number?.getAttribute("data-ojtrace-original-count");
  if (!number || original === null || original === undefined) return;
  number.textContent = original;
  number.removeAttribute("data-ojtrace-original-count");
}

export function mountLuoguCrossOjRecordList(
  problem: CrossOjProblemRef,
  request: () => Promise<CrossOjResponse>,
  refresh?: (continueScan?: boolean) => Promise<CrossOjResponse>,
  explicitProblemId?: string,
): () => void {
  let active = true;
  const disposeUserCard = mountLuoguUserCard();
  let response: CrossOjResponse | undefined;
  let requestError: string | undefined;
  let generatedList: HTMLElement | undefined;
  let injectedRows: HTMLElement[] = [];
  let hiddenEmptyState: HTMLElement | undefined;
  let emptyStateWasHidden: boolean | "until-found" = false;
  let emptyStateOriginalStyle: string | null = null;
  let activeResult: HTMLElement | undefined;
  let renderedResultCard: HTMLElement | undefined;
  let renderedSignature = "";
  let renderInFlight = false;
  let pendingRender = false;
  let nativeListAttempts = 0;

  const restoreEmptyState = (): void => {
    if (!hiddenEmptyState) return;
    if (hiddenEmptyState.isConnected) {
      hiddenEmptyState.hidden = emptyStateWasHidden;
      if (emptyStateOriginalStyle === null)
        hiddenEmptyState.removeAttribute("style");
      else hiddenEmptyState.setAttribute("style", emptyStateOriginalStyle);
    }
    hiddenEmptyState = undefined;
    emptyStateOriginalStyle = null;
    emptyStateWasHidden = false;
  };

  const resolveScopes = (): Promise<NativeRecordScopes | undefined> => {
    const current = findContent();
    const nativeList = current
      ? [...current.resultCard.querySelectorAll<HTMLElement>(".list")].find(
          (list) => !list.hasAttribute(CROSS_OJ_ROWS_ATTRIBUTE),
        )
      : undefined;
    const nativeScopes = nativeList && scopesFromNativeRows(nativeList);
    if (nativeScopes) return Promise.resolve(nativeScopes);
    return fallbackRecordScopes();
  };

  const renderImpl = async (): Promise<void> => {
    if (!active) return;
    const content = findContent();
    if (!content) return;
    const { result, resultCard } = content;
    activeResult = result;
    if (!response) {
      const ojLabel = problem.oj === "codeforces" ? "Codeforces" : "AtCoder";
      setMessage(result, requestError ?? `正在读取 ${ojLabel} 提交记录…`);
      return;
    }

    const records = [
      ...new Map(
        (response.records ?? []).map((record) => [recordKey(record), record]),
      ).values(),
    ];
    const nativeListBeforeRender = [
      ...resultCard.querySelectorAll<HTMLElement>(".list"),
    ].find((list) => !list.hasAttribute(CROSS_OJ_ROWS_ATTRIBUTE));
    if (generatedList?.isConnected && nativeListBeforeRender) {
      generatedList.remove();
      generatedList = undefined;
      injectedRows = [];
      renderedResultCard = undefined;
      renderedSignature = "";
    }
    const signature = JSON.stringify({
      url: location.href,
      records: records.map((record) => [
        record.oj,
        record.submissionId,
        record.evaluationStatus,
        record.statusUpdatedAt,
        record.score,
        record.timeMs,
        record.memoryBytes,
        record.codeLength,
        record.language,
      ]),
      message: response.recordsMessage,
    });
    if (
      renderedResultCard === resultCard &&
      renderedSignature === signature &&
      (records.length === 0 ||
        (injectedRows.length === records.length &&
          injectedRows.every((row) => row.isConnected)))
    )
      return;

    generatedList?.remove();
    generatedList = undefined;
    injectedRows.forEach((row) => row.remove());
    injectedRows = [];

    const emptyState = resultCard.querySelector<HTMLElement>(".empty-block");
    if (records.length && emptyState) {
      if (hiddenEmptyState && hiddenEmptyState !== emptyState)
        restoreEmptyState();
      if (hiddenEmptyState !== emptyState) {
        hiddenEmptyState = emptyState;
        emptyStateWasHidden = emptyState.hidden;
        emptyStateOriginalStyle = emptyState.getAttribute("style");
      }
      emptyState.hidden = true;
      emptyState.style.setProperty("display", "none", "important");
    } else if (hiddenEmptyState?.isConnected) {
      restoreEmptyState();
    }

    if (!records.length) {
      updateResultCount(result, 0);
      setMessage(
        result,
        response.recordsMessage ?? "暂无匹配的 Codeforces / AtCoder 提交记录。",
      );
      renderedResultCard = resultCard;
      renderedSignature = signature;
      return;
    }

    const existingEmpty = resultCard.querySelector<HTMLElement>(".empty-block");
    if (!nativeListBeforeRender && !existingEmpty && nativeListAttempts < 20) {
      nativeListAttempts += 1;
      window.setTimeout(() => {
        if (active) void render();
      }, 100);
      return;
    }
    nativeListAttempts = 0;

    const scopes = await resolveScopes();
    if (!active || !resultCard.isConnected) return;
    const existingNativeList = [
      ...resultCard.querySelectorAll<HTMLElement>(".list"),
    ].find((list) => !list.hasAttribute(CROSS_OJ_ROWS_ATTRIBUTE));
    if (!scopes) {
      setMessage(
        result,
        "未能识别洛谷记录样式，未替换原生结果区域，请刷新后重试。",
      );
      renderedResultCard = resultCard;
      renderedSignature = signature;
      return;
    }

    if (existingNativeList) {
      const nativeRows = existingNativeList.querySelector<HTMLElement>(
        ".list-scroll > .list-wrap > .row-wrap",
      );
      if (nativeRows) {
        const template =
          nativeRows.querySelector<HTMLElement>(".row") ?? undefined;
        const rows = records.map((record) =>
          renderRecord(record, scopes, problem, explicitProblemId, template),
        );
        nativeRows.prepend(...rows);
        injectedRows = rows;
        updateResultCount(result, records.length);
        setMessage(result, response.recordsMessage);
        renderedResultCard = resultCard;
        renderedSignature = signature;
        return;
      }
    }

    const nextList = makeGeneratedList(
      scopes,
      records,
      problem,
      explicitProblemId,
    );
    if (existingEmpty) existingEmpty.before(nextList);
    else resultCard.append(nextList);
    generatedList = nextList;
    injectedRows = [
      ...nextList.querySelectorAll<HTMLElement>(".row-wrap > .row"),
    ];
    updateResultCount(result, records.length);
    setMessage(result, response.recordsMessage);
    renderedResultCard = resultCard;
    renderedSignature = signature;
  };

  const render = async (): Promise<void> => {
    if (!active) return;
    if (renderInFlight) {
      pendingRender = true;
      return;
    }
    renderInFlight = true;
    do {
      pendingRender = false;
      try {
        await renderImpl();
      } catch (error) {
        if (!active) return;
        requestError =
          error instanceof Error
            ? `提交记录渲染失败：${error.message}`
            : "提交记录渲染失败，请稍后刷新。";
      }
    } while (active && pendingRender);
    renderInFlight = false;
  };

  const observer = new MutationObserver((mutations) => {
    const isExtensionMutation = (mutation: MutationRecord): boolean => {
      const target =
        mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement;
      if (
        target?.closest(
          `[${CROSS_OJ_ROWS_ATTRIBUTE}], [${STATUS_MESSAGE_ATTRIBUTE}]`,
        )
      )
        return true;
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return (
        changedNodes.length > 0 &&
        changedNodes.every(
          (node) =>
            node instanceof Element &&
            (node.hasAttribute("data-ojtrace-cross-oj-record") ||
              node.hasAttribute(CROSS_OJ_ROWS_ATTRIBUTE) ||
              node.hasAttribute(STATUS_MESSAGE_ATTRIBUTE)),
        )
      );
    };
    if (mutations.every(isExtensionMutation)) return;
    void render();
  });
  const content = document.body;
  if (content) observer.observe(content, { childList: true, subtree: true });

  const readResponse = async (
    nextRequest: () => Promise<CrossOjResponse>,
  ): Promise<CrossOjResponse> => {
    const nextResponse = await nextRequest();
    if (!nextResponse.ok)
      throw new Error(nextResponse.message || "提交记录查询失败。");
    return nextResponse;
  };

  const retryTransientQueryOnce = async (): Promise<void> => {
    if (!refresh || !response?.recordsMessage?.startsWith("查询失败：")) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    if (!active) return;
    try {
      response = await readResponse(() => refresh(false));
    } catch (error) {
      response = {
        ...response,
        recordsMessage:
          error instanceof Error
            ? `查询失败，自动重试未成功：${error.message}`
            : "查询失败，自动重试未成功，请稍后刷新。",
      };
    }
    if (active) await render();
  };

  const continueReadingOlderRecords = async (): Promise<void> => {
    if (!refresh) return;
    for (let page = 0; active && response?.recordScanHasMore; page += 1) {
      try {
        const nextResponse = await readResponse(() => refresh(true));
        if (!active) return;
        response = nextResponse;
        await render();
      } catch (error) {
        if (!active) return;
        response = {
          ...response,
          recordScanHasMore: false,
          recordsMessage:
            error instanceof Error
              ? `较早记录读取中断：${error.message}`
              : "较早记录读取中断，请稍后刷新。",
        };
        await render();
        return;
      }
      if (page >= 19 && response.recordScanHasMore) {
        response = {
          ...response,
          recordScanHasMore: false,
          recordsMessage:
            "已显示最近记录；更多历史记录将在下次打开时继续读取。",
        };
        await render();
        return;
      }
    }
  };

  void readResponse(request)
    .then(async (cachedResponse) => {
      if (!active) return;
      response = cachedResponse;
      const refreshResult = refresh
        ? readResponse(refresh).then(
            (latestResponse) => ({ latestResponse }),
            (error: unknown) => ({ error }),
          )
        : undefined;
      await render();
      if (!refreshResult) return;
      const result = await refreshResult;
      if (!active) return;
      if ("error" in result) {
        const error = result.error;
        const message =
          error instanceof Error
            ? `最新记录暂时无法刷新：${error.message}`
            : "最新记录暂时无法刷新，请稍后重试。";
        if (response) response = { ...response, recordsMessage: message };
        else requestError = message;
        await render();
        return;
      }
      response = result.latestResponse;
      requestError = undefined;
      await render();
      await retryTransientQueryOnce();
      if (response.recordScanHasMore) void continueReadingOlderRecords();
    })
    .catch((error: unknown) => {
      if (!active) return;
      requestError =
        error instanceof Error
          ? `提交记录读取失败：${error.message}`
          : "提交记录读取失败，请稍后重试。";
      void render();
    });

  const dispose = (): void => {
    active = false;
    disposeUserCard();
    observer.disconnect();
    injectedRows.forEach((row) => row.remove());
    generatedList?.remove();
    restoreEmptyState();
    if (activeResult) {
      setMessage(activeResult);
      restoreResultCount(activeResult);
    }
  };
  window.addEventListener("pagehide", dispose, { once: true });
  return dispose;
}
