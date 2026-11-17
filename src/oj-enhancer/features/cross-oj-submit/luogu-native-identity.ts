import { scopedAttributes } from "./luogu-native-styles";

export function displayDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number): string => String(value).padStart(2, "0");
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return date.getFullYear() === new Date().getFullYear()
    ? `${month}-${day} ${time}`
    : `${date.getFullYear()}-${month}-${day} ${time}`;
}

export function displayBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${bytes}B`;
}

export function displayDuration(milliseconds: number): string {
  for (const [divisor, unit] of [
    [86_400_000, "d"],
    [3_600_000, "h"],
    [60_000, "min"],
    [1_000, "s"],
  ] as const) {
    if (milliseconds >= divisor)
      return `${(milliseconds / divisor).toFixed(2)}${unit}`;
  }
  return `${milliseconds}ms`;
}

export function currentLuoguUsername(): HTMLElement | undefined {
  return (
    document.querySelector<HTMLElement>(".rside .luogu-username.username") ??
    document.querySelector<HTMLElement>(".rside .luogu-username") ??
    undefined
  );
}

export function currentLuoguUserUrl(): string | undefined {
  const avatarLink =
    currentLuoguAvatar()?.closest<HTMLAnchorElement>("a[href]");
  const candidate =
    avatarLink?.href ??
    document.querySelector<HTMLAnchorElement>(
      '.top-bar a[href*="/user/"], .rside a[href*="/user/"]',
    )?.href;
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate, location.origin);
    return url.origin === location.origin &&
      /^\/user\/\d+\/?$/.test(url.pathname)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function nativeLinkAttributes(
  source?: HTMLAnchorElement | null,
): string[] {
  if (source) return scopedAttributes(source);
  const currentProfileLink =
    currentLuoguAvatar()?.closest<HTMLAnchorElement>('a[href*="/user/"]');
  return scopedAttributes(
    currentProfileLink ??
      document.querySelector<HTMLAnchorElement>("a[data-v-12b24cc3]"),
  );
}

function copyChildren(target: HTMLElement, source: Element): void {
  target.replaceChildren();
  for (const child of source.childNodes) target.append(child.cloneNode(true));
}

function linkSidebarUsername(target: HTMLElement): void {
  if (target.querySelector("a[href]")) return;
  const userUrl = currentLuoguUserUrl();
  const name = target.querySelector<HTMLElement>(":scope > span:first-child");
  if (!userUrl || !name || name.matches("a")) return;

  const link = document.createElement("a");
  link.href = userUrl;
  link.className = "";
  link.setAttribute("disabled", "false");
  for (const attribute of nativeLinkAttributes())
    link.setAttribute(attribute, "");
  for (const attribute of scopedAttributes(name))
    link.setAttribute(attribute, "");
  for (const attribute of name.attributes) {
    if (!attribute.name.startsWith("data-v-"))
      link.setAttribute(attribute.name, attribute.value);
  }
  copyChildren(link, name);
  name.replaceWith(link);

  const badge = target.querySelector<HTMLElement>(
    ':scope > span[to^="https://help.luogu.com.cn/"]',
  );
  const badgeUrl = badge?.getAttribute("to");
  if (!badge || !badgeUrl) return;
  const badgeLink = document.createElement("a");
  badgeLink.href = badgeUrl;
  badgeLink.target = "_blank";
  badgeLink.rel = "noreferrer";
  badgeLink.setAttribute("disabled", "false");
  for (const attribute of nativeLinkAttributes())
    badgeLink.setAttribute(attribute, "");
  for (const attribute of scopedAttributes(badge))
    badgeLink.setAttribute(attribute, "");
  copyChildren(badgeLink, badge);
  badge.replaceWith(badgeLink);
}

export function applyCurrentLuoguUsername(target: HTMLElement): void {
  const source = currentLuoguUsername();
  if (!source) {
    target.textContent = "洛谷用户";
    return;
  }
  target.className = source.className;
  for (const attribute of scopedAttributes(source))
    target.setAttribute(attribute, "");
  copyChildren(target, source);
  linkSidebarUsername(target);
}

export function updateNativeTemplateUsername(target: HTMLElement): void {
  const source = currentLuoguUsername();
  if (!source) return;

  const sourceName = source.querySelector<HTMLElement>(
    ":scope > span:first-child",
  );
  const name = sourceName?.textContent?.trim();
  if (name) {
    let link = target.querySelector<HTMLAnchorElement>('a[href*="/user/"]');
    if (!link) {
      link =
        target.querySelector<HTMLAnchorElement>("a:not([target='_blank'])") ??
        document.createElement("a");
      if (!link.isConnected) target.prepend(link);
      for (const attribute of nativeLinkAttributes())
        link.setAttribute(attribute, "");
      for (const attribute of scopedAttributes(sourceName))
        link.setAttribute(attribute, "");
    }
    const userUrl = currentLuoguUserUrl();
    if (userUrl) link.href = userUrl;
    link.removeAttribute("target");
    link.setAttribute("disabled", "false");
    link.textContent = name;
    link.style.cssText = sourceName?.getAttribute("style") ?? "";
  }

  const sourceBadge = source.querySelector<HTMLElement>(
    ':scope > span[to^="https://help.luogu.com.cn/"]',
  );
  const badgeUrl = sourceBadge?.getAttribute("to");
  let badgeLink = target.querySelector<HTMLAnchorElement>(
    'a[href*="award-certify"], a[target="_blank"]',
  );
  if (!badgeUrl) {
    badgeLink?.remove();
    return;
  }
  if (!badgeLink) {
    badgeLink = document.createElement("a");
    for (const attribute of nativeLinkAttributes())
      badgeLink.setAttribute(attribute, "");
    for (const attribute of scopedAttributes(sourceBadge))
      badgeLink.setAttribute(attribute, "");
    copyChildren(badgeLink, sourceBadge!);
    target.append(badgeLink);
  }
  badgeLink.href = badgeUrl;
  badgeLink.target = "_blank";
  badgeLink.rel = "noreferrer";
}

export function currentLuoguAvatar(): HTMLImageElement | undefined {
  return (
    document.querySelector<HTMLImageElement>(
      '.top-bar img[alt="User Avatar"]',
    ) ??
    document.querySelector<HTMLImageElement>('img[alt="User Avatar"]') ??
    undefined
  );
}

export function applyCurrentLuoguAvatar(
  target: HTMLImageElement,
  scopes: readonly string[],
): boolean {
  const source = currentLuoguAvatar();
  if (!source) return false;
  target.className = "avatar";
  target.src = source.currentSrc || source.src;
  target.alt = source.alt || "User Avatar";
  for (const attribute of scopes) target.setAttribute(attribute, "");
  return true;
}
