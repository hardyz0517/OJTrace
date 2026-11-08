// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/397309600"}
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CrossOjSubmissionDetail } from "../../src/oj-enhancer/features/cross-oj-submit/model";
import {
  maintainLuoguCrossOjRecordPage,
  renderLuoguCrossOjRecordPage,
  unmountLuoguCrossOjRecordPage,
} from "../../src/oj-enhancer/features/cross-oj-submit/luogu-record-page";
import { readLuoguCrossOjRecordRoute } from "../../src/oj-enhancer/features/cross-oj-submit/record-details";
import { luoguCrossOjRecordPageInstalled } from "../../src/oj-enhancer/features/cross-oj-submit/luogu-record-route";

const url =
  "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/397309600";
const route = readLuoguCrossOjRecordRoute(url)!;
const detail: CrossOjSubmissionDetail = {
  oj: "codeforces",
  submissionId: "397309600",
  problemId: "1/A",
  detailUrl: "https://codeforces.com/contest/1/submission/397309600",
  observedAt: 1_793_814_000_000,
  submittedAt: "2026-11-05T12:59:12.000Z",
  evaluationStatus: "accepted",
  rawVerdict: "OK",
  username: "HardyZ",
  problemName: "A - Theatre Square",
  language: "GNU C++17",
  timeMs: 31,
  memoryBytes: 84 * 1024,
  sourceCode: "<script>window.pwned = true</script>",
  tests: [{ index: 2, verdict: "OK", timeMs: 15, memoryBytes: 16 * 1024 }],
  truncated: false,
};

function nativeStyles(): void {
  const style = document.createElement("style");
  style.setAttribute("data-test-native-record-page-styles", "");
  style.textContent = `
    .l-card[data-v-176b97b3]{}
    .stat[data-v-a6b234bf]{}
    .menu[data-v-a3d9cd74]{}
    .sidebar-container[data-v-754e1ea4]{}
    .user-row[data-v-74194755]{}
    .test-case[data-v-72437e0c]{}
  `;
  document.head.append(style);
}

function setCurrentPage(): void {
  nativeStyles();
  document.body.innerHTML = `
    <div class="top-bar">
      Luogu navigation
      <div class="breadcrumb"><a href="/record/list">评测记录</a></div>
      <a href="/user/981551"><img alt="User Avatar" src="https://cdn.luogu.com.cn/upload/usericon/981551.png"></a>
    </div>
    <aside class="rside">
      <div class="luogu-username username" data-v-759e5bde="">
        <span data-v-759e5bde="" style="font-weight:bold;color:var(--lfe-color--pink-3)">DGFLSzfd</span>
        <span data-v-759e5bde="" to="https://help.luogu.com.cn/manual/luogu/account/award-certify"></span>
      </div>
    </aside>
    <div class="main-container">
      <div class="theme-page theme-frosted" style="--theme-body-back:#f5f5f5;--theme-card-background:rgba(255,255,255,.75);--theme-card-backdrop-filter:blur(10px)">
        <header class="native-header"></header>
        <main class="native-main"><div class="old-page">Old route content</div></main>
        <footer class="native-footer"></footer>
      </div>
    </div>
  `;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.head
    .querySelectorAll("[data-test-native-record-page-styles]")
    .forEach((element) => element.remove());
  document.body.replaceChildren();
  document.querySelector("#ojtrace-luogu-record-style")?.remove();
  document.getElementById("ojtrace-luogu-record-hide-native")?.remove();
  document.documentElement.removeAttribute(
    "data-ojtrace-luogu-record-route-active",
  );
  delete (window as Window & { pwned?: boolean }).pwned;
});

describe("Luogu-shell cross-OJ record page", () => {
  it("reuses the current themed shell and native Columba scopes", async () => {
    setCurrentPage();
    const nativeTheme = document.querySelector<HTMLElement>(".theme-page")!;

    expect(await renderLuoguCrossOjRecordPage(route, detail, url)).toEqual({
      installed: true,
    });
    expect(document.title).toBe("R397309600 - 记录详情 - 洛谷");
    expect(document.querySelector(".top-bar")?.textContent).toContain(
      "Luogu navigation",
    );
    expect(document.querySelector(".breadcrumb")?.textContent).toContain(
      "R397309600",
    );
    const breadcrumbNode = document.querySelector(".breadcrumb")?.firstChild;
    expect(maintainLuoguCrossOjRecordPage(route)).toEqual({
      needsRender: false,
    });
    expect(document.querySelector(".breadcrumb")?.firstChild).toBe(
      breadcrumbNode,
    );
    const page = document.querySelector<HTMLElement>(
      "[data-ojtrace-luogu-record-page]",
    );
    expect(page).not.toBe(nativeTheme);
    expect(page?.className).toContain("ojtrace-record-page");
    expect(page?.parentElement).toBe(nativeTheme);
    expect(nativeTheme.hidden).toBe(false);
    expect(nativeTheme.firstElementChild).toBe(page);
    expect(document.querySelector<HTMLElement>(".native-header")?.hidden).toBe(
      true,
    );
    expect(document.querySelector<HTMLElement>(".native-main")?.hidden).toBe(
      true,
    );
    expect(document.querySelector(".native-footer")).not.toBeNull();
    expect(document.querySelector(".old-page")).not.toBeNull();
    expect(
      document.querySelector("#ojtrace-luogu-record-style"),
    ).not.toBeNull();
    expect(document.querySelector(".title")?.textContent).toBe(
      "R397309600 记录详情",
    );
    expect(
      document.querySelector(".header-card")?.getAttribute("data-v-176b97b3"),
    ).toBe("");
    expect(
      document.querySelector(".stat")?.getAttribute("data-v-a6b234bf"),
    ).toBe("");
    expect(
      document.querySelector(".menu")?.getAttribute("data-v-a3d9cd74"),
    ).toBe("");
    expect(
      document
        .querySelector(".sidebar-container")
        ?.getAttribute("data-v-754e1ea4"),
    ).toBe("");
    expect(
      document.querySelector(".user-row")?.getAttribute("data-v-74194755"),
    ).toBe("");
    expect(
      document.querySelector(".test-case")?.getAttribute("data-v-72437e0c"),
    ).toBe("");
    expect(document.querySelector(".user-row")?.textContent).toContain(
      "DGFLSzfd",
    );
    expect(document.querySelector(".user-row")?.textContent).not.toContain(
      "HardyZ",
    );
    expect(
      document
        .querySelector(".ojtrace-record-avatar")
        ?.classList.contains("avatar"),
    ).toBe(true);
    expect(
      document.querySelector(".l-flex-info-row .lcolor--green-3")?.textContent,
    ).toBe("Accepted");
    expect(document.querySelector(".test-case")?.className).toContain(
      "lcolor-bg-green-3",
    );
    expect(document.querySelector(".test-case .id")?.textContent).toBe("#2");
    expect(document.querySelector(".compile-info")?.textContent).toBe(
      detail.sourceCode,
    );
    expect(document.querySelector(".compile-info script")).toBeNull();
    expect((window as Window & { pwned?: boolean }).pwned).toBeUndefined();
    expect(
      document.querySelector<HTMLAnchorElement>(".problem-row a")?.pathname,
    ).toBe("/problem/CF1A");

    document.querySelectorAll<HTMLElement>(".entry")[1]?.click();
    const cards = document.querySelectorAll<HTMLElement>(".main > .l-card");
    expect(cards[1]?.hidden).toBe(false);
    expect(cards[0]?.hidden).toBe(true);
    expect(cards[1]?.getAttribute("data-ojtrace-panel")).toBe("source");
    expect(cards[1]?.style.display).toBe("");
    expect(cards[0]?.style.display).toBe("none");

    document.querySelectorAll<HTMLElement>(".entry")[0]?.click();
    expect(cards[0]?.style.display).toBe("");
    expect(cards[1]?.style.display).toBe("none");
  });

  it("renders a truthful empty state when test detail was not captured", async () => {
    setCurrentPage();
    const withoutTests = { ...detail, tests: [] };

    expect(
      await renderLuoguCrossOjRecordPage(route, withoutTests, url),
    ).toEqual({
      installed: true,
    });
    expect(document.querySelector(".test-case-wrap")?.textContent).toContain(
      "原站未提供测试点详情",
    );
    expect(document.querySelectorAll(".test-case")).toHaveLength(0);
  });

  it("keeps the native shell intact and removes only the extension page on unmount", async () => {
    nativeStyles();
    document.body.innerHTML = `
      <div class="top-bar"><a href="/user/981551"><img alt="User Avatar" src="https://cdn.luogu.com.cn/upload/usericon/981551.png"></a></div>
      <aside class="rside"><div class="luogu-username username"><span>DGFLSzfd</span></div></aside>
      <div class="main-container">
        <div class="theme-page theme-frosted">
          <div class="l-card">Native Luogu shell</div>
        </div>
      </div>
    `;
    const native = document.querySelector<HTMLElement>(".theme-page")!;
    expect(await renderLuoguCrossOjRecordPage(route, detail, url)).toEqual({
      installed: true,
    });
    expect(native.hidden).toBe(false);
    expect(
      document.querySelector("[data-ojtrace-luogu-record-page] .title")
        ?.textContent,
    ).toBe("R397309600 记录详情");
    native.replaceChildren(
      Object.assign(document.createElement("div"), {
        className: "l-card",
        textContent: "Native Luogu shell",
      }),
    );
    expect(maintainLuoguCrossOjRecordPage(route)).toEqual({
      needsRender: true,
    });
    expect(native.hidden).toBe(false);
    expect(
      document.querySelector("[data-ojtrace-luogu-record-page]"),
    ).toBeNull();
    unmountLuoguCrossOjRecordPage();
    expect(
      document.querySelector("[data-ojtrace-luogu-record-page]"),
    ).toBeNull();
    expect(native.hidden).toBe(false);
    expect(document.querySelector("#ojtrace-luogu-record-style")).toBeNull();
  });

  it("asks for a rerender after Vue wipes the mounted record page", async () => {
    setCurrentPage();
    expect(await renderLuoguCrossOjRecordPage(route, detail, url)).toEqual({
      installed: true,
    });
    const page = document.querySelector("[data-ojtrace-luogu-record-page]");
    expect(page?.parentElement).toBe(document.querySelector(".theme-page"));
    page?.remove();
    document.querySelector(".theme-page")?.replaceChildren();
    expect(maintainLuoguCrossOjRecordPage(route)).toEqual({
      needsRender: true,
    });
  });

  it("rejects a duplicate header/main pair and repairs it on the next render", async () => {
    setCurrentPage();
    expect(await renderLuoguCrossOjRecordPage(route, detail, url)).toEqual({
      installed: true,
    });
    const host = document.querySelector<HTMLElement>(".theme-page")!;
    const owned = [
      ...host.querySelectorAll<HTMLElement>(
        "[data-ojtrace-luogu-record-node][data-ojtrace-luogu-record-page]",
      ),
    ];
    owned.forEach((node) => host.append(node.cloneNode(true)));
    expect(
      document.querySelectorAll("[data-ojtrace-luogu-record-node]"),
    ).toHaveLength(4);
    expect(luoguCrossOjRecordPageInstalled(route)).toBe(false);
    expect(maintainLuoguCrossOjRecordPage(route)).toEqual({
      needsRender: true,
    });

    expect(await renderLuoguCrossOjRecordPage(route, detail, url)).toEqual({
      installed: true,
    });
    expect(
      document.querySelectorAll("[data-ojtrace-luogu-record-node]"),
    ).toHaveLength(2);
    expect(luoguCrossOjRecordPageInstalled(route)).toBe(true);
  });

  it("allows only the last concurrent render to commit", async () => {
    setCurrentPage();
    const renders = await Promise.all([
      renderLuoguCrossOjRecordPage(route, detail, url),
      renderLuoguCrossOjRecordPage(route, detail, url),
    ]);
    expect(renders).toEqual([{ installed: true }, { installed: true }]);
    expect(
      document.querySelectorAll("[data-ojtrace-luogu-record-node]"),
    ).toHaveLength(2);
    expect(document.querySelectorAll(".header-card")).toHaveLength(1);
    expect(document.querySelectorAll(".main-content")).toHaveLength(1);
  });

  it("keeps the two-column structure when Luogu scoped CSS is unavailable", async () => {
    setCurrentPage();
    document.head
      .querySelector("[data-test-native-record-page-styles]")
      ?.remove();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("stylesheet discovery unavailable");
      }),
    );

    expect(await renderLuoguCrossOjRecordPage(route, detail, url)).toEqual({
      installed: true,
    });
    expect(
      document
        .querySelector(".sidebar-container")
        ?.classList.contains("ojtrace-record-layout-fallback"),
    ).toBe(true);
  });

  it("does not render after the route changes, including to another record", async () => {
    setCurrentPage();
    expect(
      await renderLuoguCrossOjRecordPage(
        route,
        detail,
        "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/123456789",
      ),
    ).toEqual({ installed: false });
    expect(
      document.querySelector("[data-ojtrace-luogu-record-page]"),
    ).toBeNull();
    expect(document.querySelector(".old-page")).not.toBeNull();
  });

  it("requires the active hash route to match before rendering", async () => {
    setCurrentPage();
    expect(await renderLuoguCrossOjRecordPage(route, detail, url)).toEqual({
      installed: true,
    });
  });

  it("rejects a detail that does not match the route", async () => {
    setCurrentPage();
    expect(
      await renderLuoguCrossOjRecordPage(
        route,
        { ...detail, submissionId: "123" },
        url,
      ),
    ).toEqual({ installed: false });
  });

  it("loads extra Columba CSS from the current user's own record when needed", async () => {
    nativeStyles();
    document.head
      .querySelector("[data-test-native-record-page-styles]")
      ?.remove();
    document.body.innerHTML = `
      <div class="top-bar"><a href="/user/981551"><img alt="User Avatar" src="https://cdn.luogu.com.cn/upload/usericon/981551.png"></a></div>
      <aside class="rside"><div class="luogu-username username"><span>DGFLSzfd</span></div></aside>
      <div class="main-container"><div class="theme-page theme-frosted"></div></div>
    `;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href.includes("/record/list")) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              data: {
                records: {
                  result: [{ id: 307923752, problem: { pid: "P1001" } }],
                },
              },
            }),
        };
      }
      if (href.endsWith("/record/307923752")) {
        return {
          ok: true,
          text: async () =>
            '<link rel="stylesheet" href="https://fecdn.luogu.com.cn/columba/MOD1189~record.css">',
        };
      }
      throw new Error(`unexpected fetch ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await renderLuoguCrossOjRecordPage(route, detail, url)).toEqual({
      installed: true,
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(
      document.querySelector<HTMLLinkElement>(
        'link[href="https://fecdn.luogu.com.cn/columba/MOD1189~record.css"]',
      ),
    ).not.toBeNull();
    expect(
      fetchMock.mock.calls
        .map((call) => String(call[0]))
        .some((href) => href.includes("290510067")),
    ).toBe(false);
  });
});
