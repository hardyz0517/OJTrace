export interface LuoguUserCardProfile {
  uid: number;
  name: string;
  avatar?: string;
  background?: string;
  slogan?: string;
  followingCount?: number;
  followerCount?: number;
  ranking?: number;
  eloValue?: number;
}

const CARD_STYLE_ATTRIBUTE = "data-ojtrace-luogu-user-card-style";
const CARD_ATTRIBUTE = "data-ojtrace-luogu-user-card";
const TRIGGER_ATTRIBUTE = "data-ojtrace-luogu-user-card-trigger";
const MAX_PROFILE_RESPONSE_LENGTH = 1_000_000;
const DEFAULT_BACKGROUND =
  "https://cdn.luogu.com.cn/images/bg/fe/DSCF0530-shrink.jpg";
const DEFAULT_SLOGAN = "这个家伙很懒，什么也没有留下。";
const SHOW_DELAY_MS = 100;
const HIDE_DELAY_MS = 80;
const CARD_WIDTH_PX = 390;
const profileRequests = new Map<
  string,
  Promise<LuoguUserCardProfile | undefined>
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function publicImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdn.luogu.com.cn"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function safeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function eloRatingFrom(value: unknown): number | undefined {
  const fromRecord = (record: Record<string, unknown>): number | undefined =>
    safeCount(record.rating) ?? safeCount(record.eloValue);
  if (Array.isArray(value)) {
    const latest = value.find((item) => isRecord(item) && item.latest === true);
    return (
      (isRecord(latest) ? fromRecord(latest) : undefined) ??
      value.reduce<number | undefined>((found, item) => {
        if (found !== undefined || !isRecord(item)) return found;
        return fromRecord(item);
      }, undefined)
    );
  }
  return isRecord(value) ? fromRecord(value) : safeCount(value);
}

function profileFromPayload(
  payload: unknown,
  expectedUid: number,
): LuoguUserCardProfile | undefined {
  if (!isRecord(payload)) return undefined;
  const currentData = isRecord(payload.currentData)
    ? payload.currentData
    : undefined;
  const data = isRecord(payload.data) ? payload.data : undefined;
  const user = [currentData?.user, data?.user, payload.user].find(isRecord);
  if (!user || user.uid !== expectedUid || typeof user.name !== "string")
    return undefined;

  const eloValue =
    safeCount(user.eloValue) ??
    eloRatingFrom(user.elo) ??
    eloRatingFrom(currentData?.elo) ??
    eloRatingFrom(data?.elo) ??
    eloRatingFrom(payload.elo);
  return {
    uid: expectedUid,
    name: user.name.slice(0, 80),
    ...(publicImageUrl(user.avatar)
      ? { avatar: publicImageUrl(user.avatar) }
      : {}),
    ...(publicImageUrl(user.background)
      ? { background: publicImageUrl(user.background) }
      : {}),
    ...(typeof user.slogan === "string"
      ? { slogan: user.slogan.slice(0, 240) }
      : {}),
    ...(safeCount(user.followingCount) !== undefined
      ? { followingCount: safeCount(user.followingCount) }
      : {}),
    ...(safeCount(user.followerCount) !== undefined
      ? { followerCount: safeCount(user.followerCount) }
      : {}),
    ...(safeCount(user.ranking) !== undefined
      ? { ranking: safeCount(user.ranking) }
      : {}),
    ...(eloValue !== undefined ? { eloValue } : {}),
  };
}

/** Parse the public Luogu profile response, accepting its JSON and page forms. */
export function parseLuoguUserCardProfile(
  responseText: string,
  expectedUid: number,
): LuoguUserCardProfile | undefined {
  if (
    !Number.isSafeInteger(expectedUid) ||
    expectedUid <= 0 ||
    responseText.length > MAX_PROFILE_RESPONSE_LENGTH
  )
    return undefined;

  try {
    return profileFromPayload(JSON.parse(responseText) as unknown, expectedUid);
  } catch {
    const page = new DOMParser().parseFromString(responseText, "text/html");
    const context = page.querySelector<HTMLScriptElement>(
      "script#lentille-context[type='application/json']",
    );
    if (!context?.textContent) return undefined;
    try {
      return profileFromPayload(
        JSON.parse(context.textContent) as unknown,
        expectedUid,
      );
    } catch {
      return undefined;
    }
  }
}

function profileUrl(
  link: HTMLAnchorElement,
): { href: string; uid: number } | undefined {
  try {
    const url = new URL(link.href, location.origin);
    const match = /^\/user\/(\d+)\/?$/.exec(url.pathname);
    const uid = match ? Number(match[1]) : NaN;
    if (
      url.origin !== location.origin ||
      url.username ||
      url.password ||
      !Number.isSafeInteger(uid) ||
      uid <= 0
    )
      return undefined;
    url.search = "";
    url.hash = "";
    url.searchParams.set("_contentOnly", "1");
    return { href: url.href, uid };
  } catch {
    return undefined;
  }
}

function loadProfile(request: {
  href: string;
  uid: number;
}): Promise<LuoguUserCardProfile | undefined> {
  let pending = profileRequests.get(request.href);
  if (!pending) {
    pending = fetch(request.href, {
      method: "GET",
      credentials: "include",
      cache: "force-cache",
      headers: { Accept: "application/json,text/html;q=0.9" },
    })
      .then(async (response) => {
        if (!response.ok) {
          profileRequests.delete(request.href);
          return undefined;
        }
        const profile = parseLuoguUserCardProfile(
          await response.text(),
          request.uid,
        );
        if (!profile) profileRequests.delete(request.href);
        return profile;
      })
      .catch(() => {
        profileRequests.delete(request.href);
        return undefined;
      });
    profileRequests.set(request.href, pending);
  }
  return pending;
}

function cssSelectorsOf(sheet: CSSStyleSheet): string[] {
  const selectors: string[] = [];
  const visit = (list: CSSRuleList): void => {
    for (const rule of list) {
      if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText);
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
  return selectors;
}

function scopeFromStyles(marker: RegExp): string | undefined {
  for (const sheet of document.styleSheets) {
    for (const selector of cssSelectorsOf(sheet)) {
      const match = marker.exec(selector);
      marker.lastIndex = 0;
      if (match?.[1]) return `data-v-${match[1]}`;
    }
  }
  return undefined;
}

function scopeFromDom(className: string): string | undefined {
  const element = document.querySelector(`.${className}`);
  const attribute = element
    ? [...element.attributes].find((item) =>
        /^data-v-[\da-f]+$/.test(item.name),
      )
    : undefined;
  return attribute?.name;
}

function applyScope(element: Element, scope: string | undefined): void {
  if (scope) element.setAttribute(scope, "");
}

const styleText = `
[${CARD_ATTRIBUTE}]{--duration:var(--dropdown-transition-duration,.15s);--transitions:opacity var(--duration) ease-out;--dropdown-z-index:1005;position:fixed;box-sizing:border-box;opacity:0;transition:z-index 0s var(--duration),var(--transitions);pointer-events:none;z-index:-2147483648;text-align:left}
[${CARD_ATTRIBUTE}].shown{transition:var(--transitions);pointer-events:auto;z-index:var(--dropdown-z-index)}
[${CARD_ATTRIBUTE}] .l-card{display:block;background-color:var(--theme-card-background,#fff);border-radius:4px;box-shadow:0 1px 3px #1a1a1a1a;box-sizing:border-box;margin-bottom:0;min-width:0;padding:var(--l-card--padding,1.3em)}
[${CARD_ATTRIBUTE}] .float-card{width:${CARD_WIDTH_PX}px;max-width:calc(100vw - 24px);box-shadow:0 0 6px 4px rgba(26,26,26,.1)!important;font-size:1rem;line-height:1.1;padding:0}
[${CARD_ATTRIBUTE}] .user-header-top{position:relative;height:100px;background:#eee center/cover no-repeat}
[${CARD_ATTRIBUTE}] .user-header-top .avatar{width:60px;height:60px;border-radius:50%;position:absolute;top:70px;left:12px;border:0;background:#fff;object-fit:cover}
[${CARD_ATTRIBUTE}] .user-info{padding:.25em .625em .625em 80px}
[${CARD_ATTRIBUTE}] .user-info>*{margin:.6em 0}
[${CARD_ATTRIBUTE}] .user-name{min-height:1.5em}
[${CARD_ATTRIBUTE}] .slogan{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[${CARD_ATTRIBUTE}] .lfe-caption{color:gray;font-size:.875em}
[${CARD_ATTRIBUTE}] .stat{display:inline-block}
[${CARD_ATTRIBUTE}] .stat>.field{display:inline-block!important;color:#333}
[${CARD_ATTRIBUTE}] .tiled.stat>.field{margin-right:.6em}
[${CARD_ATTRIBUTE}] .tiled.stat>.field:last-child{margin-right:unset}
[${CARD_ATTRIBUTE}] .tiled.stat>.field>.name{font-weight:400;color:var(--lfe-color--grey-4,#888)}
[${CARD_ATTRIBUTE}] .tiled.stat>.field>.value{margin-left:.2em}
[${CARD_ATTRIBUTE}] .ojtrace-user-card-spinner{display:inline-block;width:1em;height:1em;border:2px solid rgba(0,0,0,.12);border-top-color:rgba(0,0,0,.45);border-radius:50%;vertical-align:middle;animation:ojtrace-user-card-spin .7s linear infinite}
@keyframes ojtrace-user-card-spin{to{transform:rotate(360deg)}}
@media screen and (width<=576px){
[${CARD_ATTRIBUTE}] .stat.tiled{display:flex;flex-wrap:wrap;gap:.45em .75em;width:100%}
[${CARD_ATTRIBUTE}] .tiled.stat>.field{display:inline-flex!important;flex:0 0 calc(50% - .375em);justify-content:flex-start;align-items:center;min-width:0;margin-right:0}
}
`;

function cssBackground(url: string): string {
  return `url('${url.replace(/'/g, "\\'")}')`;
}

function addStatField(parent: HTMLElement, label: string, value: string): void {
  const field = document.createElement("div");
  field.className = "field";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = label;
  const amount = document.createElement("span");
  amount.className = "value";
  amount.textContent = value;
  field.append(name, amount);
  parent.append(field);
}

function fillUserName(
  container: HTMLElement,
  link: HTMLAnchorElement,
  profile: LuoguUserCardProfile | undefined,
  fallback: { uid: number; name: string },
): void {
  container.replaceChildren();
  const source = link.closest(".luogu-username");
  const uid = profile?.uid ?? fallback.uid;
  const href = `${location.origin}/user/${uid}`;
  if (source) {
    const clone = source.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return;
    clone.querySelectorAll(`a[${TRIGGER_ATTRIBUTE}]`).forEach((anchor) => {
      anchor.removeAttribute(TRIGGER_ATTRIBUTE);
    });
    const nameLink =
      clone.querySelector<HTMLAnchorElement>('a[href*="/user/"]') ??
      clone.querySelector<HTMLAnchorElement>("a:not([target='_blank'])");
    if (nameLink) {
      nameLink.href = href;
      nameLink.target = "_blank";
      nameLink.rel = "noreferrer";
      nameLink.textContent = profile?.name ?? fallback.name;
    }
    container.append(clone);
    return;
  }
  const nameLink = document.createElement("a");
  nameLink.href = href;
  nameLink.target = "_blank";
  nameLink.rel = "noreferrer";
  nameLink.textContent = profile?.name ?? fallback.name;
  nameLink.style.cssText = link.getAttribute("style") ?? "";
  container.append(nameLink);
}

function renderStats(
  container: HTMLElement,
  profile: LuoguUserCardProfile | undefined,
  loading: boolean,
): void {
  container.replaceChildren();
  if (loading) {
    const spinner = document.createElement("span");
    spinner.className = "ojtrace-user-card-spinner";
    spinner.setAttribute("aria-hidden", "true");
    container.append(spinner);
    return;
  }
  const stats = document.createElement("div");
  stats.className = "stat tiled";
  applyScope(stats, scopeFromStyles(/\.stat\[data-v-([\da-f]+)\]/i));
  addStatField(stats, "关注", String(profile?.followingCount ?? 0));
  addStatField(stats, "粉丝", String(profile?.followerCount ?? 0));
  addStatField(
    stats,
    "排名",
    profile?.ranking === undefined ? "-" : String(profile.ranking),
  );
  if (profile?.eloValue !== undefined)
    addStatField(stats, "等级分", String(profile.eloValue));
  container.append(stats);
}

function applyProfile(
  card: HTMLElement,
  profile: LuoguUserCardProfile | undefined,
  fallback: { uid: number; name: string; avatar?: string },
  link: HTMLAnchorElement,
  loading: boolean,
): void {
  const cover = card.querySelector<HTMLElement>(".user-header-top");
  const avatar = card.querySelector<HTMLImageElement>(
    ".user-header-top .avatar",
  );
  const nameBox = card.querySelector<HTMLElement>(".user-name");
  const slogan = card.querySelector<HTMLElement>(".slogan");
  const stats = card.querySelector<HTMLElement>(".user-stat-data");
  if (!cover || !avatar || !nameBox || !slogan || !stats) return;

  fillUserName(nameBox, link, profile, fallback);
  const avatarUrl = profile?.avatar ?? fallback.avatar;
  const displayName = profile?.name ?? fallback.name;
  if (avatarUrl) {
    avatar.src = avatarUrl;
    avatar.alt = displayName;
  } else {
    avatar.removeAttribute("src");
    avatar.alt = "";
  }
  cover.style.backgroundImage = cssBackground(
    profile?.background ?? DEFAULT_BACKGROUND,
  );
  slogan.textContent = profile?.slogan?.trim()
    ? profile.slogan
    : DEFAULT_SLOGAN;
  renderStats(stats, loading ? undefined : profile, loading);
  card.dataset.state = loading ? "loading" : profile ? "ready" : "unavailable";
  card.setAttribute("aria-busy", loading ? "true" : "false");
}

function createCard(): HTMLElement {
  const dropdown = document.createElement("div");
  dropdown.className = "dropdown";
  dropdown.setAttribute(CARD_ATTRIBUTE, "");
  dropdown.setAttribute("role", "dialog");
  dropdown.setAttribute("aria-label", "洛谷用户资料");
  dropdown.setAttribute("aria-hidden", "true");
  dropdown.style.setProperty("--dropdown-z-index", "1005");
  const dropdownScope =
    scopeFromStyles(/\.dropdown\[data-v-([\da-f]+)\]/i) ??
    scopeFromDom("dropdown");
  const cardScope = scopeFromStyles(/\.l-card\[data-v-([\da-f]+)\]/i);
  const floatScope =
    scopeFromStyles(/\.float-card\[data-v-([\da-f]+)\]/i) ??
    scopeFromDom("float-card");
  applyScope(dropdown, dropdownScope);

  const card = document.createElement("div");
  card.className = "l-card float-card";
  card.style.padding = "0";
  applyScope(card, cardScope);
  applyScope(card, floatScope);

  const cover = document.createElement("div");
  cover.className = "user-header-top";
  cover.style.backgroundImage = cssBackground(DEFAULT_BACKGROUND);
  applyScope(cover, floatScope);

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.alt = "";
  applyScope(avatar, floatScope);
  cover.append(avatar);

  const info = document.createElement("div");
  info.className = "user-info";
  applyScope(info, floatScope);

  const name = document.createElement("div");
  name.className = "user-name";

  const slogan = document.createElement("div");
  slogan.className = "lfe-caption slogan";
  slogan.textContent = DEFAULT_SLOGAN;
  applyScope(slogan, floatScope);

  const stats = document.createElement("div");
  stats.className = "user-stat-data lfe-caption";
  applyScope(stats, floatScope);

  info.append(name, slogan, stats);
  card.append(cover, info);
  dropdown.append(card);
  return dropdown;
}

function cardHost(): HTMLElement {
  return document.getElementById("app") ?? document.body;
}

/** Install a Luogu-native user card on injected username links. */
export function mountLuoguUserCard(): () => void {
  const style = document.createElement("style");
  style.setAttribute(CARD_STYLE_ATTRIBUTE, "");
  style.textContent = styleText;
  document.head.append(style);
  const card = createCard();
  cardHost().append(card);

  let activeLink: HTMLAnchorElement | undefined;
  let showTimer: number | undefined;
  let hideTimer: number | undefined;
  let requestToken = 0;
  let previousDescribedBy: string | null = null;

  const cancelTimers = (): void => {
    if (showTimer !== undefined) window.clearTimeout(showTimer);
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    showTimer = undefined;
    hideTimer = undefined;
  };

  const restoreLinkDescription = (): void => {
    if (!activeLink) return;
    if (previousDescribedBy === null)
      activeLink.removeAttribute("aria-describedby");
    else activeLink.setAttribute("aria-describedby", previousDescribedBy);
    previousDescribedBy = null;
  };

  const position = (link: HTMLAnchorElement): void => {
    const rect = link.getBoundingClientRect();
    const width = card.getBoundingClientRect().width || CARD_WIDTH_PX;
    const height = card.getBoundingClientRect().height || 210;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = height > spaceBelow && rect.top > spaceBelow;
    const top = Math.max(6, placeAbove ? rect.top - height : rect.bottom);
    const left = Math.max(
      10,
      Math.min(
        rect.left + (rect.width - width) / 2,
        window.innerWidth - width - 20,
      ),
    );
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };

  const conceal = (): void => {
    cancelTimers();
    card.classList.remove("shown");
    card.style.opacity = "0";
    card.setAttribute("aria-hidden", "true");
    restoreLinkDescription();
    activeLink = undefined;
  };

  const open = async (link: HTMLAnchorElement): Promise<void> => {
    const request = profileUrl(link);
    if (!request) return;
    if (activeLink !== link) restoreLinkDescription();
    activeLink = link;
    requestToken += 1;
    const currentToken = requestToken;
    previousDescribedBy = link.getAttribute("aria-describedby");
    link.setAttribute("aria-describedby", "ojtrace-luogu-user-card");
    card.id = "ojtrace-luogu-user-card";
    const rowAvatar = link
      .closest<HTMLElement>(".user")
      ?.querySelector<HTMLImageElement>("img.avatar");
    const fallbackAvatar = publicImageUrl(
      rowAvatar?.currentSrc || rowAvatar?.src,
    );
    const fallback = {
      uid: request.uid,
      name: link.textContent?.trim().slice(0, 80) || "洛谷用户",
      ...(fallbackAvatar ? { avatar: fallbackAvatar } : {}),
    };
    applyProfile(card, undefined, fallback, link, true);
    card.classList.add("shown");
    card.setAttribute("aria-hidden", "false");
    card.style.opacity = "0";
    position(link);
    requestAnimationFrame(() => {
      if (currentToken !== requestToken || activeLink !== link) return;
      card.style.opacity = "1";
    });

    const profile = await loadProfile(request);
    if (currentToken !== requestToken || activeLink !== link) return;
    applyProfile(card, profile, fallback, link, false);
    position(link);
  };

  const trigger = (
    target: EventTarget | null,
  ): HTMLAnchorElement | undefined => {
    const element = target instanceof Element ? target : undefined;
    const link = element?.closest<HTMLAnchorElement>(`a[${TRIGGER_ATTRIBUTE}]`);
    return link?.isConnected ? link : undefined;
  };

  const beginShow = (link: HTMLAnchorElement, immediate: boolean): void => {
    cancelTimers();
    if (activeLink === link && card.classList.contains("shown")) {
      card.style.opacity = "1";
      return;
    }
    const show = (): void => void open(link);
    if (immediate) show();
    else showTimer = window.setTimeout(show, SHOW_DELAY_MS);
  };

  const scheduleHide = (): void => {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      conceal();
      hideTimer = undefined;
    }, HIDE_DELAY_MS);
  };

  const onMouseOver = (event: MouseEvent): void => {
    const link = trigger(event.target);
    if (link && !link.contains(event.relatedTarget as Node | null))
      beginShow(link, false);
    else if (card.contains(event.target as Node)) cancelTimers();
  };
  const onMouseOut = (event: MouseEvent): void => {
    const next = event.relatedTarget as Node | null;
    const link = trigger(event.target);
    if (link && !link.contains(next) && !card.contains(next)) scheduleHide();
    else if (card.contains(event.target as Node) && !card.contains(next)) {
      if (!activeLink || !activeLink.contains(next)) scheduleHide();
    }
  };
  const onFocusIn = (event: FocusEvent): void => {
    const link = trigger(event.target);
    if (link) beginShow(link, true);
    else if (card.contains(event.target as Node)) cancelTimers();
  };
  const onFocusOut = (event: FocusEvent): void => {
    const leavingTrigger = Boolean(trigger(event.target));
    const leavingCard = card.contains(event.target as Node);
    const nextTarget = event.relatedTarget as Node | null;
    if (
      (leavingTrigger &&
        !card.contains(nextTarget) &&
        nextTarget !== activeLink) ||
      (leavingCard && !card.contains(nextTarget) && nextTarget !== activeLink)
    )
      scheduleHide();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !card.classList.contains("shown")) return;
    const link = activeLink;
    conceal();
    link?.focus();
  };
  const onReposition = (): void => {
    if (activeLink && card.classList.contains("shown")) position(activeLink);
  };

  document.addEventListener("mouseover", onMouseOver);
  document.addEventListener("mouseout", onMouseOut);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("scroll", onReposition, true);
  window.addEventListener("resize", onReposition);
  return () => {
    cancelTimers();
    requestToken += 1;
    restoreLinkDescription();
    document.removeEventListener("mouseover", onMouseOver);
    document.removeEventListener("mouseout", onMouseOut);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("scroll", onReposition, true);
    window.removeEventListener("resize", onReposition);
    card.remove();
    style.remove();
  };
}

export function markLuoguUserCardTrigger(link: HTMLAnchorElement): void {
  link.setAttribute(TRIGGER_ATTRIBUTE, "");
}
