// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.luogu.com.cn/record/list?pid=CF1A"}
import { afterEach, describe, expect, it, vi } from "vitest";
import { installLuoguMainRecordRouteGuard } from "../../src/oj-enhancer/features/cross-oj-submit/luogu-record-route-main";
import { LUOGU_CROSS_OJ_RECORD_ROUTE_MESSAGE_SOURCE } from "../../src/oj-enhancer/features/cross-oj-submit/luogu-record-route-shared";

const originalPushState = History.prototype.pushState;
const originalReplaceState = History.prototype.replaceState;

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-ojtrace-luogu-record-main");
  Reflect.deleteProperty(history, "pushState");
  Reflect.deleteProperty(history, "replaceState");
  History.prototype.pushState = originalPushState;
  History.prototype.replaceState = originalReplaceState;
  delete (window as Window & { __ojtraceLuoguMainRecordRoute?: boolean })
    .__ojtraceLuoguMainRecordRoute;
  originalReplaceState.call(
    history,
    history.state,
    "",
    "https://www.luogu.com.cn/record/list?pid=CF1A",
  );
});

describe("Luogu MAIN-world record route guard", () => {
  it("notifies the isolated world when a valid hash record route is pushed", () => {
    const posted: unknown[] = [];
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation((message: unknown) => {
        posted.push(message);
      });
    expect(installLuoguMainRecordRouteGuard(window)).toBe(true);
    history.pushState(
      {},
      "",
      "/record/list?pid=CF1A#ojtrace-record=cf/397475296",
    );
    expect(location.pathname).toBe("/record/list");
    expect(location.hash).toBe("#ojtrace-record=cf/397475296");
    expect(posted).toEqual([
      { source: LUOGU_CROSS_OJ_RECORD_ROUTE_MESSAGE_SOURCE },
    ]);
    postMessage.mockRestore();
  });

  it("leaves ordinary Luogu history writes alone", () => {
    installLuoguMainRecordRouteGuard(window);
    history.pushState({}, "", "/problem/CF1A");
    expect(location.pathname).toBe("/problem/CF1A");
  });

  it("does not cancel ordinary clicks", () => {
    const postMessage = vi.spyOn(window, "postMessage");
    installLuoguMainRecordRouteGuard(window);
    document.body.innerHTML = `<a href="/problem/CF1A">CF1A</a>`;
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    document.querySelector("a")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });
});
