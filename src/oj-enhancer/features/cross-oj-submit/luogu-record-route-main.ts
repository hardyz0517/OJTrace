/** Notify the isolated world about hash/history changes without taking over Luogu's router. */

import {
  LUOGU_CROSS_OJ_RECORD_MAIN_ATTRIBUTE,
  LUOGU_CROSS_OJ_RECORD_ROUTE_ADOPT_SOURCE,
  LUOGU_CROSS_OJ_RECORD_ROUTE_MESSAGE_SOURCE,
} from "./luogu-record-route-shared";
import { readLuoguCrossOjRecordRoute } from "./record-details";

const MARKER = "__ojtraceLuoguMainRecordRoute";

export interface LuoguRecordRouteWindow {
  top: unknown;
  location: Location;
  history: History;
  document: Document;
  addEventListener: Window["addEventListener"];
  postMessage: Window["postMessage"];
}

function isOwnedRoute(href: string, page: LuoguRecordRouteWindow): boolean {
  try {
    const url = new URL(href, page.location.href);
    return (
      url.origin === page.location.origin &&
      url.pathname === "/record/list" &&
      (url.hash === "" || readLuoguCrossOjRecordRoute(url.href) !== undefined)
    );
  } catch {
    return false;
  }
}

function notifyIsolatedWorld(page: LuoguRecordRouteWindow): void {
  page.postMessage(
    { source: LUOGU_CROSS_OJ_RECORD_ROUTE_MESSAGE_SOURCE },
    page.location.origin,
  );
}

export function installLuoguMainRecordRouteGuard(
  page: LuoguRecordRouteWindow,
): boolean {
  if (page.top !== page) return false;
  const marked = page as LuoguRecordRouteWindow & Record<string, unknown>;
  if (marked[MARKER]) return false;
  marked[MARKER] = true;
  page.document.documentElement.setAttribute(
    LUOGU_CROSS_OJ_RECORD_MAIN_ATTRIBUTE,
    "",
  );

  const historyProto = Object.getPrototypeOf(page.history) as History;
  const nativePushState = historyProto.pushState.bind(page.history);
  const nativeReplaceState = historyProto.replaceState.bind(page.history);
  const wrapHistoryWrite = (
    native: History["pushState"],
  ): History["pushState"] => {
    return function patchedHistoryWrite(
      this: History,
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ) {
      const result = native.call(this, data, unused, url);
      if (url !== undefined && url !== null && isOwnedRoute(String(url), page))
        notifyIsolatedWorld(page);
      return result;
    };
  };

  historyProto.pushState = wrapHistoryWrite(historyProto.pushState);
  historyProto.replaceState = wrapHistoryWrite(historyProto.replaceState);
  page.history.pushState = wrapHistoryWrite(nativePushState);
  page.history.replaceState = wrapHistoryWrite(nativeReplaceState);

  const notify = (): void => notifyIsolatedWorld(page);
  page.addEventListener("popstate", notify);
  page.addEventListener("hashchange", notify);
  page.addEventListener("message", (event) => {
    const message = event as MessageEvent;
    if (message.origin !== page.location.origin) return;
    const data = message.data;
    if (
      !data ||
      typeof data !== "object" ||
      (data as { source?: unknown }).source !==
        LUOGU_CROSS_OJ_RECORD_ROUTE_ADOPT_SOURCE
    )
      return;
    const href = (data as { href?: unknown }).href;
    if (typeof href !== "string" || !isOwnedRoute(href, page)) return;
    page.history.pushState(page.history.state, "", href);
    notifyIsolatedWorld(page);
  });
  return true;
}
