/** Own OJTrace's hash record route without leaving Luogu's current page shell. */

import { readLuoguCrossOjRecordRoute } from "./record-details";
import {
  LUOGU_CROSS_OJ_RECORD_MAIN_ATTRIBUTE,
  LUOGU_CROSS_OJ_RECORD_PAGE_ATTRIBUTE,
  LUOGU_CROSS_OJ_RECORD_ROUTE_ADOPT_SOURCE,
  LUOGU_CROSS_OJ_RECORD_ROUTE_EVENT,
  LUOGU_CROSS_OJ_RECORD_ROUTE_KEY_ATTRIBUTE,
  LUOGU_CROSS_OJ_RECORD_ROUTE_MESSAGE_SOURCE,
} from "./luogu-record-route-shared";

export {
  LUOGU_CROSS_OJ_RECORD_PAGE_ATTRIBUTE,
  LUOGU_CROSS_OJ_RECORD_ROUTE_EVENT,
  LUOGU_CROSS_OJ_RECORD_ROUTE_KEY_ATTRIBUTE,
  LUOGU_CROSS_OJ_RECORD_ROUTE_MESSAGE_SOURCE,
};

const CLICK_GUARD_ATTRIBUTE = "data-ojtrace-luogu-record-click-guard";
const LOCATION_WATCH_ATTRIBUTE = "data-ojtrace-luogu-location-watch";
const RECORD_NODE_ATTRIBUTE = "data-ojtrace-luogu-record-node";
const RECORD_NODE_KIND_ATTRIBUTE = "data-ojtrace-luogu-record-node-kind";

type RecordRoute = NonNullable<ReturnType<typeof readLuoguCrossOjRecordRoute>>;

export function luoguCrossOjRecordRouteKey(route: RecordRoute): string {
  return `${route.oj}:${route.contestId}:${route.submissionId}`;
}

export function currentLuoguDocumentUrl(href = location.href): string {
  try {
    const url = new URL(href, "https://www.luogu.com.cn");
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

export function currentLuoguNavigationUrl(href = location.href): string {
  try {
    const url = new URL(href, "https://www.luogu.com.cn");
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

export function readLuoguCrossOjRecordHref(
  href: string,
  base = location.href,
): RecordRoute | undefined {
  try {
    return readLuoguCrossOjRecordRoute(new URL(href, base).href);
  } catch {
    return undefined;
  }
}

function dispatchRouteChange(): void {
  window.dispatchEvent(new Event(LUOGU_CROSS_OJ_RECORD_ROUTE_EVENT));
}

function absoluteRecordUrl(
  href: string,
  base = location.href,
): string | undefined {
  try {
    const url = new URL(href, base);
    if (url.origin !== "https://www.luogu.com.cn") return undefined;
    if (!readLuoguCrossOjRecordRoute(url.href)) return undefined;
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

export function adoptLuoguCrossOjRecordUrl(href: string): boolean {
  const nextUrl = absoluteRecordUrl(href);
  if (!nextUrl) return false;
  if (
    document.documentElement.hasAttribute(LUOGU_CROSS_OJ_RECORD_MAIN_ATTRIBUTE)
  ) {
    window.postMessage(
      { source: LUOGU_CROSS_OJ_RECORD_ROUTE_ADOPT_SOURCE, href: nextUrl },
      location.origin,
    );
    return true;
  }
  if (currentLuoguNavigationUrl(location.href) !== nextUrl) {
    history.pushState(history.state, "", nextUrl);
  }
  dispatchRouteChange();
  return true;
}

function recordAnchorFromEvent(event: Event): HTMLAnchorElement | undefined {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement) return node;
  }
  const target = event.target;
  return target instanceof Element
    ? (target.closest("a") ?? undefined)
    : undefined;
}

function shouldLeaveToBrowser(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    Boolean(anchor.target && anchor.target !== "_self") ||
    anchor.hasAttribute("download")
  );
}

function handleRecordLinkClick(event: MouseEvent): void {
  const anchor = recordAnchorFromEvent(event);
  if (!anchor || shouldLeaveToBrowser(event, anchor)) return;
  const href = anchor.getAttribute("href");
  if (!href || !readLuoguCrossOjRecordHref(href)) return;
  if (!adoptLuoguCrossOjRecordUrl(href)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function installLuoguCrossOjRecordClickGuard(): () => void {
  if (document.documentElement.hasAttribute(CLICK_GUARD_ATTRIBUTE)) {
    return () => undefined;
  }
  document.documentElement.setAttribute(CLICK_GUARD_ATTRIBUTE, "");
  document.addEventListener("click", handleRecordLinkClick, true);
  return () => {
    document.removeEventListener("click", handleRecordLinkClick, true);
    document.documentElement.removeAttribute(CLICK_GUARD_ATTRIBUTE);
  };
}

export function watchLuoguLocationChanges(onChange: () => void): () => void {
  let lastUrl = currentLuoguNavigationUrl();
  const notify = (): void => {
    const nextUrl = currentLuoguNavigationUrl();
    if (nextUrl === lastUrl) return;
    lastUrl = nextUrl;
    onChange();
  };
  const onMessage = (event: MessageEvent): void => {
    if (event.origin !== location.origin) return;
    if (
      event.data &&
      typeof event.data === "object" &&
      (event.data as { source?: unknown }).source ===
        LUOGU_CROSS_OJ_RECORD_ROUTE_MESSAGE_SOURCE
    )
      notify();
  };
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
  window.addEventListener(LUOGU_CROSS_OJ_RECORD_ROUTE_EVENT, notify);
  window.addEventListener("message", onMessage);
  const poll = window.setInterval(notify, 200);
  document.documentElement.setAttribute(LOCATION_WATCH_ATTRIBUTE, "");
  return () => {
    window.clearInterval(poll);
    window.removeEventListener("popstate", notify);
    window.removeEventListener("hashchange", notify);
    window.removeEventListener(LUOGU_CROSS_OJ_RECORD_ROUTE_EVENT, notify);
    window.removeEventListener("message", onMessage);
    document.documentElement.removeAttribute(LOCATION_WATCH_ATTRIBUTE);
  };
}

export function luoguCrossOjRecordPageInstalled(route: RecordRoute): boolean {
  const routeKey = luoguCrossOjRecordRouteKey(route);
  const nodes = [
    ...document.querySelectorAll<HTMLElement>(
      `[${RECORD_NODE_ATTRIBUTE}][${LUOGU_CROSS_OJ_RECORD_PAGE_ATTRIBUTE}]`,
    ),
  ];
  const headers = nodes.filter(
    (node) =>
      node.getAttribute(RECORD_NODE_KIND_ATTRIBUTE) === "header" &&
      node.getAttribute(LUOGU_CROSS_OJ_RECORD_ROUTE_KEY_ATTRIBUTE) === routeKey,
  );
  const mains = nodes.filter(
    (node) =>
      node.getAttribute(RECORD_NODE_KIND_ATTRIBUTE) === "main" &&
      node.getAttribute(LUOGU_CROSS_OJ_RECORD_ROUTE_KEY_ATTRIBUTE) === routeKey,
  );
  return (
    nodes.length === 2 &&
    headers.length === 1 &&
    mains.length === 1 &&
    headers[0]?.parentElement === mains[0]?.parentElement &&
    Boolean(headers[0]?.querySelector(".header-card"))
  );
}

export function shouldRefreshLuoguCrossOjRecordPage(
  route: RecordRoute,
): boolean {
  return !luoguCrossOjRecordPageInstalled(route);
}
