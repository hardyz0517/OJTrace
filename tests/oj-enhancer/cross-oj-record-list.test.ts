// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.luogu.com.cn/record/list?pid=CF1A&user=981551"}
import { afterEach, describe, expect, it, vi } from "vitest";
import nativeMetricBlock from "../../docs/fixtures/luogu/record-list-metrics.html?raw";
import { mountLuoguCrossOjRecordList as mountNativeRecordList } from "../../src/oj-enhancer/features/cross-oj-submit/record-list";
import type {
  CrossOjProblemRef,
  CrossOjRecordListItem,
  CrossOjResponse,
} from "../../src/oj-enhancer/features/cross-oj-submit/model";
import { deferred } from "../helpers/deferred";

const problem: CrossOjProblemRef = {
  oj: "codeforces",
  contestId: "1",
  index: "A",
  source: "luogu-pid",
};

const records: CrossOjRecordListItem[] = [
  {
    oj: "codeforces",
    submissionId: "11",
    problemId: "1/A",
    detailUrl: "https://codeforces.com/contest/1/submission/11",
    observedAt: 1_700_000_000_000,
    statusUpdatedAt: 1_700_000_000_000,
    evaluationStatus: "accepted",
    accountName: "alice",
    problemName: "A - Theatre Square",
    language: "GNU C++17",
    score: 1,
    timeMs: 31,
    memoryBytes: 86_016,
    codeLength: 100,
  },
  {
    oj: "codeforces",
    submissionId: "12",
    problemId: "1/A",
    detailUrl: "https://codeforces.com/contest/1/submission/12",
    observedAt: 1_700_000_001_000,
    statusUpdatedAt: 1_700_000_001_000,
    evaluationStatus: "rejected",
    accountName: "bob",
  },
];

const disposers: Array<() => void> = [];

function mount(
  query: () => Promise<CrossOjResponse>,
  refresh?: () => Promise<CrossOjResponse>,
  selectedProblem: CrossOjProblemRef = problem,
  problemId?: string,
  requestDifficulty?: () => Promise<CrossOjResponse>,
): () => void {
  Object.defineProperty(globalThis, "browser", {
    configurable: true,
    value: {
      runtime: {
        getURL: () => "chrome-extension://ojtrace-test/timeline.html",
      },
    },
  });
  const dispose = mountNativeRecordList(
    selectedProblem,
    query,
    refresh,
    problemId,
    requestDifficulty,
  );
  disposers.push(dispose);
  return dispose;
}

function nativePage(input: { empty?: boolean; count?: number } = {}): void {
  document.body.innerHTML = `
    <div class="main-container">
      <main class="main-content">
        <div class="l-card">
          <div class="result"><span class="count">共计 <span class="number">${input.count ?? 0}</span> 条结果 <a href="javascript:void(0)">隐藏难度</a></span><div class="actions"><button>搜索</button></div></div>
        </div>
        <div class="l-card result-card">
          ${
            input.empty
              ? '<div class="empty-block" style="color: blue;"><span class="title">没有找到结果</span></div>'
              : `
            <div class="list" data-v-84064f0e="" data-v-ac22f036="">
              <div class="list-scroll" data-v-84064f0e="">
                <div class="list-wrap table border" data-v-84064f0e="">
                  <div class="row-wrap" data-v-84064f0e="">
                    <div class="row" data-v-84064f0e="">
                      <div data-v-ac22f036="" data-v-84064f0e-s=""><div class="user" data-v-ac22f036="" data-v-84064f0e-s=""><div class="user-info" data-v-ac22f036="" data-v-84064f0e-s=""><div class="luogu-username" data-v-759e5bde="" data-v-ac22f036=""><span data-v-2b916ac8="" data-v-759e5bde=""><span data-v-2b916ac8=""><a data-v-12b24cc3="" data-v-759e5bde="" data-v-2b916ac8-s="" href="https://www.luogu.com.cn/user/981551" style="font-weight:bold;color:var(--lfe-color--pink-3)">Native User</a></span></span><a data-v-12b24cc3="" data-v-759e5bde="" target="_blank" href="https://help.luogu.com.cn/manual/luogu/account/award-certify"><svg class="svg-inline--fa fa-badge-check" aria-hidden="true"></svg></a></div><span class="lfe-caption">2024-01-01 00:00</span></div></div></div>
                      <div data-v-ac22f036="" data-v-84064f0e-s=""><a class="status"><span>AC</span></a></div>
                      <div class="problem" data-v-ac22f036="" data-v-84064f0e-s=""></div>
                      <div data-v-ac22f036="" data-v-84064f0e-s="">${nativeMetricBlock}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `
          }
        </div>
      </main>
    </div>
    <div class="top-bar"><span class="avatar"><a data-v-12b24cc3="" href="/user/981551"><img alt="User Avatar" src="https://cdn.luogu.com.cn/upload/usericon/981551.png"></a></span></div>
    <aside class="rside"><div class="luogu-username username" data-v-759e5bde=""><span data-v-759e5bde="" style="font-weight:bold;color:var(--lfe-color--pink-3)">DGFLSzfd</span><span data-v-759e5bde="" target="_blank" to="https://help.luogu.com.cn/manual/luogu/account/award-certify"><svg class="svg-inline--fa fa-badge-check" aria-hidden="true"></svg></span></div></aside>
  `;
}

function response(
  value: CrossOjRecordListItem[],
  recordsMessage?: string,
  problemDifficulty?: number,
): CrossOjResponse {
  return {
    schemaVersion: 1,
    requestId: "unused",
    ok: true,
    code: "records-loaded",
    records: value,
    ...(recordsMessage ? { recordsMessage } : {}),
    ...(problemDifficulty !== undefined ? { problemDifficulty } : {}),
  };
}

async function nextMutationTurn(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  vi.useRealTimers();
  document.head
    .querySelectorAll("style[data-test-native-record-styles]")
    .forEach((node) => node.remove());
  document.body.replaceChildren();
  history.replaceState(null, "", "/record/list?pid=CF1A&user=981551");
  Reflect.deleteProperty(globalThis, "browser");
});

describe("Luogu native cross-OJ record rows", () => {
  it("matches the native MHTML metric spacing and both literal separators", async () => {
    nativePage({ count: 1 });
    const nativeMetrics = document.querySelector(".row .metrics")!;
    const nativeText = nativeMetrics.textContent;
    mount(async () =>
      response([
        {
          ...records[0]!,
          timeMs: 42,
          memoryBytes: 1072 * 1024,
          codeLength: 100,
        },
      ]),
    );
    await nextMutationTurn();
    const actual = document.querySelector(
      '[data-ojtrace-record-id="codeforces:11"] .metrics',
    )!;
    expect(actual.textContent).toBe(nativeText);
    expect(actual.textContent?.split(" \u00a0/\u00a0 ")).toHaveLength(3);
    expect(
      [...actual.querySelectorAll("svg")].map((icon) =>
        icon.getAttribute("data-icon"),
      ),
    ).toEqual(["clock", "database", "ruler-combined"]);
  });

  it.each([
    [206, "206ms"],
    [6040, "6.04s"],
    [3720, "3.72s"],
  ] as const)(
    "uses native time formatting for %i milliseconds",
    async (timeMs, label) => {
      nativePage({ count: 1 });
      const record = { ...records[0]!, timeMs, codeLength: 3942 };
      mount(async () => response([record]));
      await nextMutationTurn();
      const actual = document.querySelector(
        '[data-ojtrace-record-id="codeforces:11"] .metrics',
      )!;
      expect(actual.textContent).toBe(
        ` ${label} \u00a0/\u00a0  84.00KB \u00a0/\u00a0  3.85KB`,
      );
    },
  );

  it("refreshes on entry and on a native search with the same URL", async () => {
    nativePage();
    const search = document.querySelector<HTMLButtonElement>(".result button")!;
    search.className = "l-button l-button-primary";
    search.setAttribute("data-v-native", "");
    const onSearch = vi.fn();
    search.addEventListener("click", onSearch);
    const manual = deferred<CrossOjResponse>();
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(response([records[0]!], undefined, 5))
      .mockImplementationOnce(() => manual.promise);
    const dispose = mount(async () => response([]), refresh);
    await nextMutationTurn();
    expect(document.querySelectorAll(".result button")).toHaveLength(1);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(false);
    search.click();
    search.click();
    await nextMutationTurn();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(search.disabled).toBe(false);
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")?.textContent,
    ).toContain("正在刷新");
    expect(
      document.querySelectorAll("[data-ojtrace-cross-oj-record]"),
    ).toHaveLength(1);
    manual.resolve(response(records));
    await nextMutationTurn();
    expect(search.textContent?.trim()).toBe("搜索");
    expect(
      document.querySelectorAll("[data-ojtrace-cross-oj-record]"),
    ).toHaveLength(2);
    expect(
      document.querySelector<HTMLElement>(
        "[data-ojtrace-cross-oj-record] .problem strong",
      )?.style.color,
    ).toBe("var(--lfe-color--cyan-3)");
    dispose();
    expect(document.querySelector("[data-ojtrace-record-refresh]")).toBeNull();
    expect(search.isConnected).toBe(true);
    search.click();
    await nextMutationTurn();
    expect(onSearch).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("recovers from a failed cached read with the automatic refresh", async () => {
    nativePage();
    const refresh = vi.fn(async () => response(records));
    mount(async () => {
      throw new Error("cache unavailable");
    }, refresh);
    await nextMutationTurn();
    expect(refresh).toHaveBeenCalledExactlyOnceWith(false);
    expect(
      document.querySelectorAll("[data-ojtrace-cross-oj-record]"),
    ).toHaveLength(2);
    expect(
      document.querySelector<HTMLButtonElement>(".result button")?.disabled,
    ).toBe(false);
  });

  it("refreshes on Enter in Luogu's search inputs", async () => {
    nativePage();
    const input = document.createElement("input");
    input.placeholder = "题目编号";
    document.querySelector(".result")!.parentElement!.prepend(input);
    const refresh = vi.fn(async () => response(records));
    mount(async () => response([]), refresh);
    await nextMutationTurn();
    input.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Enter", bubbles: true }),
    );
    await nextMutationTurn();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("leaves a changed search URL to the new page mount", async () => {
    nativePage();
    const refresh = vi.fn(async () => response(records));
    mount(async () => response([]), refresh);
    await nextMutationTurn();
    const search = document.querySelector<HTMLButtonElement>(".result button")!;
    search.addEventListener("click", () =>
      history.pushState(null, "", "/record/list?pid=CF1B"),
    );
    search.click();
    await nextMutationTurn();
    expect(location.search).toBe("?pid=CF1B");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps records after a manual refresh error and enables retry", async () => {
    nativePage();
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(response([records[0]!]))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(response(records));
    mount(async () => response([]), refresh);
    await nextMutationTurn();
    const button = document.querySelector<HTMLButtonElement>(".result button")!;
    button.click();
    await nextMutationTurn();
    expect(
      document.querySelectorAll("[data-ojtrace-cross-oj-record]"),
    ).toHaveLength(1);
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")?.textContent,
    ).toContain("network unavailable");
    expect(button.disabled).toBe(false);
    button.click();
    await nextMutationTurn();
    expect(
      document.querySelectorAll("[data-ojtrace-cross-oj-record]"),
    ).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("binds native search again after Vue replaces the controls", async () => {
    nativePage();
    const original =
      document.querySelector<HTMLElement>(".result")!.parentElement!;
    const replacement = original.cloneNode(true);
    const pending = deferred<CrossOjResponse>();
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(response([]))
      .mockImplementationOnce(() => pending.promise);
    const dispose = mount(async () => response([]), refresh);
    await nextMutationTurn();
    original.replaceWith(replacement);
    await nextMutationTurn();
    expect(document.querySelectorAll(".result button")).toHaveLength(1);
    document.querySelector<HTMLButtonElement>(".result button")!.click();
    await nextMutationTurn();
    expect(refresh).toHaveBeenCalledTimes(2);
    dispose();
    pending.resolve(response(records));
    await nextMutationTurn();
    expect(document.querySelector("[data-ojtrace-record-refresh]")).toBeNull();
    expect(document.querySelector("[data-ojtrace-cross-oj-record]")).toBeNull();
  });
  it.each([
    [0, "0B"],
    [8192, "8.00KB"],
    [2 * 1024 * 1024, "2.00MB"],
  ] as const)(
    "renders CF API memory %i with a code-size placeholder",
    async (memoryBytes, expectedMemory) => {
      nativePage({ count: 1 });
      const record = { ...records[0]!, memoryBytes };
      delete record.codeLength;
      mount(async () => response([record]));
      await nextMutationTurn();
      const metrics = document.querySelector(
        '[data-ojtrace-record-id="codeforces:11"] .detail .metrics',
      );
      const measures = metrics?.querySelector(".fa-database")?.parentElement;
      const codeSize =
        metrics?.querySelector(".fa-ruler-combined")?.parentElement;
      expect(metrics?.textContent).toBe(
        ` 31ms \u00a0/\u00a0  ${expectedMemory} \u00a0/\u00a0  —`,
      );
      expect(measures?.textContent).toContain(expectedMemory);
      expect(codeSize?.textContent?.trim()).toBe("—");
      expect(codeSize?.title).toContain("代码长度暂不可用");
      expect(record.memoryBytes).toBe(memoryBytes);
    },
  );

  it.each([
    {
      name: "zero values",
      timeMs: 0,
      memoryBytes: 0,
      codeLength: 0,
      expected: " 0ms \u00a0/\u00a0  0B \u00a0/\u00a0  0B",
    },
    {
      name: "missing values",
      timeMs: undefined,
      memoryBytes: undefined,
      codeLength: undefined,
      expected: " — \u00a0/\u00a0  — \u00a0/\u00a0  —",
    },
  ])("renders $name distinctly for every metric", async (input) => {
    nativePage({ count: 1 });
    const record = {
      ...records[0]!,
      timeMs: input.timeMs,
      memoryBytes: input.memoryBytes,
      codeLength: input.codeLength,
    };
    mount(async () => response([record]));
    await nextMutationTurn();
    const metrics = document.querySelector(
      '[data-ojtrace-record-id="codeforces:11"] .metrics',
    )!;
    expect(metrics.textContent).toBe(input.expected);
    expect(metrics.querySelectorAll("svg")).toHaveLength(3);
    expect(
      metrics.querySelector(".fa-ruler-combined")?.parentElement?.title,
    ).toBe(input.codeLength === undefined ? "代码长度暂不可用" : "代码长度");
  });

  it("renders cached rows before waiting for the fresh query", async () => {
    nativePage({ count: 1 });
    let finishRefresh!: (value: CrossOjResponse) => void;
    const fresh = new Promise<CrossOjResponse>((resolve) => {
      finishRefresh = resolve;
    });
    const cachedRequest = vi.fn(async () => response([records[0]!]));
    const refreshRequest = vi.fn(() => fresh);
    mount(cachedRequest, refreshRequest);
    await nextMutationTurn();

    expect(cachedRequest).toHaveBeenCalledOnce();
    expect(refreshRequest).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".row")).toHaveLength(2);
    expect(
      document.querySelector("[data-ojtrace-cross-oj-record]")?.textContent,
    ).toContain("DGFLSzfd");

    finishRefresh(response(records));
    await nextMutationTurn();
    expect(document.querySelectorAll(".row")).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-ojtrace-cross-oj-record]"),
    ).toHaveLength(2);
  });

  it("waits for a delayed native list instead of creating a second list", async () => {
    nativePage({ count: 1 });
    const resultCard = document.querySelector<HTMLElement>(".result-card")!;
    const nativeList = resultCard.querySelector<HTMLElement>(".list")!;
    nativeList.remove();
    const dispose = mount(async () => response(records));

    await nextMutationTurn();
    expect(
      resultCard.querySelector("[data-ojtrace-luogu-record-list]"),
    ).toBeNull();

    resultCard.append(nativeList);
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    expect(
      resultCard.querySelector("[data-ojtrace-luogu-record-list]"),
    ).toBeNull();
    expect(
      resultCard.querySelectorAll("[data-ojtrace-cross-oj-record]"),
    ).toHaveLength(2);
    expect(resultCard.querySelectorAll(".row")).toHaveLength(3);
    dispose();
  });

  it("shows each record page while continuing the older-history scan", async () => {
    nativePage({ count: 0 });
    const olderRecord = {
      ...records[1]!,
      submissionId: "13",
      detailUrl: "https://codeforces.com/contest/1/submission/13",
    };
    let continuation = false;
    const refresh = vi.fn(async (continueScan?: boolean) => {
      if (continueScan) {
        continuation = true;
        return {
          ...response([records[0]!, olderRecord]),
          recordScanHasMore: false,
        };
      }
      return {
        ...response([records[0]!], "正在读取更早的提交记录…"),
        recordScanHasMore: true,
      };
    });
    const dispose = mount(async () => response([]), refresh);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(continuation).toBe(true);
    expect(refresh.mock.calls.map((call) => call[0])).toEqual([false, true]);
    expect(
      document.querySelector('[data-ojtrace-record-id="codeforces:11"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-ojtrace-record-id="codeforces:13"]'),
    ).not.toBeNull();
    dispose();
  });

  it("retries a transient record-query failure once", async () => {
    nativePage({ count: 0 });
    const refresh = vi
      .fn<() => Promise<CrossOjResponse>>()
      .mockResolvedValueOnce(response([], "查询失败：HTTP 502"))
      .mockResolvedValueOnce(response([records[0]!]));
    const dispose = mount(async () => response([]), refresh);
    await new Promise<void>((resolve) => setTimeout(resolve, 550));

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector('[data-ojtrace-record-id="codeforces:11"]'),
    ).not.toBeNull();
    dispose();
  });

  it("inserts records into the existing native list without replacing its controls or rows", async () => {
    nativePage({ count: 1 });
    const searchButton = document.querySelector(".result button");
    const request = vi.fn(async () =>
      response(records, "提交记录刚刚更新过，请稍后再刷新。"),
    );
    const dispose = mount(request);
    await nextMutationTurn();

    const rows = document.querySelectorAll(".list-wrap > .row-wrap > .row");
    expect(request).toHaveBeenCalledOnce();
    expect(document.querySelector(".result button")).toBe(searchButton);
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")?.textContent,
    ).toBe("提交记录刚刚更新过，请稍后再刷新。");
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")
        ?.previousElementSibling?.textContent,
    ).toBe("隐藏难度");
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")?.parentElement,
    ).toBe(document.querySelector(".result .count"));
    expect(document.querySelector(".result .actions > button")).toBe(
      searchButton,
    );
    expect(document.querySelectorAll(".row")).toHaveLength(3);
    expect(
      document.querySelectorAll("[data-ojtrace-cross-oj-record]"),
    ).toHaveLength(2);
    expect(document.querySelector("[data-ojtrace-cross-oj-rows]")).toBeNull();
    expect(document.querySelector(".result .number")?.textContent).toBe("3");
    expect(
      document
        .querySelector(
          '[data-ojtrace-record-id="codeforces:11"] .status > span',
        )
        ?.classList.contains("lcolor--green-3"),
    ).toBe(true);
    expect(
      document
        .querySelector(
          '[data-ojtrace-record-id="codeforces:12"] .status > span',
        )
        ?.classList.contains("lcolor--red-3"),
    ).toBe(true);
    expect(
      document.querySelector('[data-ojtrace-record-id="codeforces:11"] .status')
        ?.textContent,
    ).toContain("Accepted");
    expect(
      document.querySelector('[data-ojtrace-record-id="codeforces:11"] .status')
        ?.textContent,
    ).toContain("100");
    expect(document.querySelector("#ojtrace-cross-oj-record-list")).toBeNull();
    expect(
      document.querySelector(".row .luogu-username")?.textContent,
    ).toContain("DGFLSzfd");
    expect(
      document.querySelector(".row .luogu-username")?.textContent,
    ).not.toContain("alice");
    expect(
      document
        .querySelector<HTMLAnchorElement>(
          ".row .luogu-username a[href*='/user/']",
        )
        ?.hasAttribute("data-v-12b24cc3"),
    ).toBe(true);
    expect(
      document
        .querySelector<HTMLAnchorElement>(
          ".row .luogu-username a[href*='award-certify']",
        )
        ?.hasAttribute("data-v-12b24cc3"),
    ).toBe(true);
    expect(document.querySelector(".row .metrics .fa-clock")).not.toBeNull();
    expect(document.querySelector(".row .fa-file-code")).not.toBeNull();
    expect(
      document.querySelector<HTMLImageElement>(".row .user img.avatar")?.src,
    ).toBe("https://cdn.luogu.com.cn/upload/usericon/981551.png");
    expect(
      document.querySelector(".row .luogu-username .fa-badge-check"),
    ).not.toBeNull();
    const usernameLink = document.querySelector<HTMLAnchorElement>(
      '[data-ojtrace-record-id="codeforces:11"] .luogu-username a[href*="/user/"]',
    );
    expect(usernameLink?.href).toBe("https://www.luogu.com.cn/user/981551");
    expect(usernameLink?.hasAttribute("data-v-12b24cc3")).toBe(true);
    const badgeLink = document.querySelector<HTMLAnchorElement>(
      '[data-ojtrace-record-id="codeforces:11"] .luogu-username a[href*="award-certify"]',
    );
    expect(badgeLink?.hasAttribute("data-v-12b24cc3")).toBe(true);
    const metrics = document.querySelector<HTMLElement>(
      '[data-ojtrace-record-id="codeforces:11"] .detail .metrics',
    );
    expect(metrics?.querySelectorAll(":scope > span")).toHaveLength(2);
    expect(metrics?.querySelector(".fa-clock")).not.toBeNull();
    expect(metrics?.querySelector(".fa-database")).not.toBeNull();
    expect(metrics?.querySelector(".fa-ruler-combined")).not.toBeNull();
    expect(metrics?.textContent).toContain("84.00KB");
    expect(metrics?.textContent).toContain("100B");
    expect(
      document.querySelector(
        '[data-ojtrace-record-id="codeforces:11"] .detail .fa-file-code',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector<HTMLAnchorElement>(
        '[data-ojtrace-record-id="codeforces:11"] .status',
      )?.href,
    ).toBe("https://codeforces.com/contest/1/submission/11");
    const problemLink = document.querySelector<HTMLAnchorElement>(
      '[data-ojtrace-record-id="codeforces:11"] .problem a',
    );
    expect(problemLink?.href).toBe("https://www.luogu.com.cn/problem/CF1A");
    expect(problemLink?.textContent).toBe("CF1A Theatre Square");
    expect(problemLink?.hasAttribute("target")).toBe(false);
    expect(rows[2]?.textContent).toContain("Native User");

    dispose();
    expect(document.querySelectorAll(".row")).toHaveLength(1);
    expect(document.querySelector(".result .number")?.textContent).toBe("1");
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]"),
    ).toBeNull();
  });

  it("uses Luogu difficulty colors and follows the native visibility toggle", async () => {
    nativePage({ count: 1 });
    document.querySelector<HTMLElement>(".problem")!.innerHTML =
      '<a><strong style="color: var(--lfe-color--pink-3)">P1001</strong></a>';
    const dispose = mount(async () => response([records[0]!], undefined, 5));
    await nextMutationTurn();

    const problemName = document.querySelector<HTMLElement>(
      '[data-ojtrace-record-id="codeforces:11"] .problem strong',
    )!;
    expect(problemName.style.color).toBe("var(--lfe-color--cyan-3)");

    const toggle = document.querySelector<HTMLElement>(".result .count a")!;
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      toggle.textContent =
        toggle.textContent?.trim() === "隐藏难度" ? "显示难度" : "隐藏难度";
    });
    toggle.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(
      document.querySelector<HTMLElement>(
        '[data-ojtrace-record-id="codeforces:11"] .problem strong',
      )?.style.color,
    ).toBe("");

    toggle.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(
      document.querySelector<HTMLElement>(
        '[data-ojtrace-record-id="codeforces:11"] .problem strong',
      )?.style.color,
    ).toBe("var(--lfe-color--cyan-3)");
    dispose();
  });

  it("follows rebuilt native controls without replacing rows or predicting clicks", async () => {
    nativePage();
    const originalResult = document.querySelector<HTMLElement>(".result")!;
    const originalToggle =
      originalResult.querySelector<HTMLElement>(".count a")!;
    originalToggle.addEventListener("click", () => {
      const replacement = originalResult.cloneNode(true) as HTMLElement;
      const toggle = replacement.querySelector<HTMLElement>(".count a")!;
      toggle.textContent = "隐藏难度";
      let shown = true;
      toggle.addEventListener("click", () => {
        shown = !shown;
        queueMicrotask(() => {
          toggle.textContent = shown ? "隐藏难度" : "显示难度";
        });
      });
      originalResult.replaceWith(replacement);
    });
    mount(async () => response([records[0]!], undefined, 5));
    await nextMutationTurn();
    const row = document.querySelector("[data-ojtrace-cross-oj-record]")!;
    const name = row.querySelector<HTMLElement>(".problem strong")!;
    originalToggle.click();
    await nextMutationTurn();
    expect(name.style.color).toBe("var(--lfe-color--cyan-3)");
    const toggle = document.querySelector<HTMLElement>(".result .count a")!;
    toggle.click();
    await nextMutationTurn();
    expect(name.style.color).toBe("");
    toggle.click();
    toggle.click();
    toggle.click();
    await nextMutationTurn();
    expect(toggle.textContent).toBe("隐藏难度");
    expect(name.style.color).toBe("var(--lfe-color--cyan-3)");
    expect(document.querySelector("[data-ojtrace-cross-oj-record]")).toBe(row);
  });

  it("recovers a first missing difficulty without refreshing the records", async () => {
    vi.useFakeTimers();
    nativePage();
    const metadata = vi
      .fn()
      .mockResolvedValueOnce({
        ...response([]),
        problemDifficultyRetryAt: Date.now() + 1_000,
      })
      .mockResolvedValueOnce(response([], undefined, 5));
    const query = vi.fn(async () => response([records[0]!]));
    mount(query, undefined, problem, undefined, metadata);
    await vi.advanceTimersByTimeAsync(0);
    const row = document.querySelector("[data-ojtrace-cross-oj-record]")!;
    expect(row.querySelector<HTMLElement>(".problem strong")?.style.color).toBe(
      "",
    );
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")?.textContent,
    ).toContain("自动重试");
    await vi.advanceTimersByTimeAsync(999);
    expect(metadata).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(metadata).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(1);
    expect(row.querySelector<HTMLElement>(".problem strong")?.style.color).toBe(
      "var(--lfe-color--cyan-3)",
    );
    expect(document.querySelector("[data-ojtrace-cross-oj-record]")).toBe(row);
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]"),
    ).toBeNull();
  });

  it("applies pending metadata using the latest native visibility", async () => {
    nativePage();
    const pending = deferred<CrossOjResponse>();
    const metadata = vi.fn(() => pending.promise);
    const freshRecords = deferred<CrossOjResponse>();
    mount(
      async () => response([records[0]!]),
      () => freshRecords.promise,
      problem,
      undefined,
      metadata,
    );
    await nextMutationTurn();
    const toggle = document.querySelector<HTMLElement>(".result .count a")!;
    toggle.addEventListener("click", () => {
      toggle.textContent =
        toggle.textContent === "隐藏难度" ? "显示难度" : "隐藏难度";
    });
    toggle.click();
    pending.resolve(response([], undefined, 5));
    freshRecords.resolve(response(records));
    await nextMutationTurn();
    const name = document.querySelector<HTMLElement>(
      "[data-ojtrace-cross-oj-record] .problem strong",
    )!;
    expect(name.style.color).toBe("");
    expect(
      document.querySelectorAll("[data-ojtrace-cross-oj-record]"),
    ).toHaveLength(2);
    toggle.click();
    await nextMutationTurn();
    expect(name.style.color).toBe("var(--lfe-color--cyan-3)");
    expect(
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-ojtrace-cross-oj-record] .problem strong",
        ),
      ].every((element) => element.style.color === "var(--lfe-color--cyan-3)"),
    ).toBe(true);
    expect(metadata).toHaveBeenCalledTimes(1);
  });

  it("pauses metadata retries while hidden and resumes on show", async () => {
    vi.useFakeTimers();
    nativePage();
    const metadata = vi
      .fn()
      .mockResolvedValueOnce({
        ...response([]),
        problemDifficultyRetryAt: Date.now() + 1_000,
      })
      .mockResolvedValueOnce(response([], undefined, 5));
    mount(
      async () => response(records),
      undefined,
      problem,
      undefined,
      metadata,
    );
    await vi.advanceTimersByTimeAsync(0);
    const toggle = document.querySelector<HTMLElement>(".result .count a")!;
    toggle.textContent = "显示难度";
    await vi.advanceTimersByTimeAsync(5_000);
    expect(metadata).toHaveBeenCalledTimes(1);
    toggle.textContent = "隐藏难度";
    await vi.advanceTimersByTimeAsync(0);
    expect(metadata).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector<HTMLElement>(
        "[data-ojtrace-cross-oj-record] .problem strong",
      )?.style.color,
    ).toBe("var(--lfe-color--cyan-3)");
  });

  it("respects metadata retry time, limits automatic retries, and supports search retry", async () => {
    vi.useFakeTimers();
    nativePage();
    const metadata = vi.fn<() => Promise<CrossOjResponse>>(async () => ({
      ...response([]),
      problemDifficultyRetryAt: Date.now() + 180_000,
    }));
    const dispose = mount(
      async () => response(records),
      async () => response(records),
      problem,
      undefined,
      metadata,
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(179_999);
    expect(metadata).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(metadata).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(metadata).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")?.textContent,
    ).toContain("搜索重试");
    metadata.mockResolvedValueOnce(response([], undefined, 1));
    document.querySelector<HTMLButtonElement>(".result button")!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(metadata).toHaveBeenCalledTimes(3);
    expect(
      document.querySelector<HTMLElement>(
        "[data-ojtrace-cross-oj-record] .problem strong",
      )?.style.color,
    ).toBe("var(--lfe-color--pink-3)");
    dispose();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(metadata).toHaveBeenCalledTimes(3);
  });

  it("ignores a late metadata response after leaving the route", async () => {
    nativePage();
    const pending = deferred<CrossOjResponse>();
    const dispose = mount(
      async () => response(records),
      undefined,
      problem,
      undefined,
      () => pending.promise,
    );
    await nextMutationTurn();
    history.pushState(null, "", "/record/list?pid=CF1B");
    pending.resolve(response([], undefined, 1));
    await nextMutationTurn();
    expect(
      document.querySelector<HTMLElement>(
        "[data-ojtrace-cross-oj-record] .problem strong",
      )?.style.color,
    ).toBe("");
    dispose();
    expect(document.querySelector("[data-ojtrace-cross-oj-record]")).toBeNull();
  });

  it("keeps a known difficulty when a later record response omits metadata", async () => {
    nativePage();
    let finishRefresh!: (value: CrossOjResponse) => void;
    mount(
      async () => response([records[0]!], undefined, 1),
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
    await nextMutationTurn();
    const problemColor = () =>
      document.querySelector<HTMLElement>(
        '[data-ojtrace-record-id="codeforces:11"] .problem strong',
      )?.style.color;
    expect(problemColor()).toBe("var(--lfe-color--pink-3)");

    finishRefresh(response(records));
    await nextMutationTurn();
    expect(problemColor()).toBe("var(--lfe-color--pink-3)");

    const toggle = document.querySelector<HTMLElement>(".result .count a")!;
    toggle.firstChild!.nodeValue = "显示难度";
    await nextMutationTurn();
    expect(problemColor()).toBe("");
    toggle.firstChild!.nodeValue = "隐藏难度";
    await nextMutationTurn();
    expect(problemColor()).toBe("var(--lfe-color--pink-3)");
  });

  it.each([
    [0, "grey-3"],
    [1, "pink-3"],
    [2, "orange-3"],
    [3, "gold-3"],
    [4, "green-3"],
    [5, "cyan-3"],
    [6, "blue-3"],
    [7, "purple-3"],
    [8, "lapis-4"],
  ] as const)(
    "renders difficulty %i from metadata as %s",
    async (difficulty, color) => {
      nativePage();
      mount(async () => response([records[0]!], undefined, difficulty));
      await nextMutationTurn();
      expect(
        document.querySelector<HTMLElement>(
          '[data-ojtrace-record-id="codeforces:11"] .problem strong',
        )?.style.color,
      ).toBe(`var(--lfe-color--${color})`);
    },
  );

  it.each([20, undefined])(
    "uses Luogu's loaded component scopes for empty results with code length %s",
    async (codeLength) => {
      nativePage({ empty: true });
      const atcoderRecord: CrossOjRecordListItem = {
        oj: "atcoder",
        submissionId: "13",
        problemId: "abc175_f",
        detailUrl: "https://atcoder.jp/contests/abc175/submissions/13",
        observedAt: 1_700_000_002_000,
        statusUpdatedAt: 1_700_000_002_000,
        evaluationStatus: "accepted",
        accountName: "alice",
        problemName: "Making Palindrome",
        language: "C++ 20",
        timeMs: 50,
        memoryBytes: 1024,
        ...(codeLength !== undefined ? { codeLength } : {}),
      };
      const listStyle = document.createElement("style");
      listStyle.setAttribute("data-test-native-record-styles", "");
      listStyle.textContent = `
      .list-wrap.table[data-v-84064f0e]{}
      .list-wrap .row-wrap > .row[data-v-84064f0e]{}
      .list-wrap .row-wrap > .row > [data-v-84064f0e-s]{}
    `;
      const componentStyle = document.createElement("style");
      componentStyle.setAttribute("data-test-native-record-styles", "");
      componentStyle.textContent = `
      .user[data-v-ac22f036],.status[data-v-ac22f036],.problem[data-v-ac22f036],.detail[data-v-ac22f036]{}
    `;
      document.head.append(listStyle, componentStyle);

      const atcoderProblem: CrossOjProblemRef = {
        oj: "atcoder",
        contestId: "abc175",
        taskId: "abc175_f",
        source: "luogu-pid",
      };
      const dispose = mount(
        async () => response([atcoderRecord], undefined, 5),
        undefined,
        atcoderProblem,
        "AT_abc175_f",
      );
      await nextMutationTurn();

      const list = document.querySelector<HTMLElement>(
        ".l-card [data-ojtrace-cross-oj-rows]",
      );
      expect(list).not.toBeNull();
      expect(list?.getAttribute("data-v-84064f0e")).toBe("");
      expect(list?.querySelector(".row")?.getAttribute("data-v-84064f0e")).toBe(
        "",
      );
      expect(document.querySelector<HTMLElement>(".empty-block")?.hidden).toBe(
        true,
      );
      expect(
        document.querySelector<HTMLElement>(".empty-block")?.style.display,
      ).toBe("none");
      expect(document.querySelectorAll(".result-card .row")).toHaveLength(1);
      expect(
        document.querySelector<HTMLAnchorElement>(".row .status")?.href,
      ).toBe(atcoderRecord.detailUrl);
      expect(
        document.querySelector<HTMLAnchorElement>(".row .problem a")?.href,
      ).toBe("https://www.luogu.com.cn/problem/AT_abc175_f");
      expect(
        document.querySelector<HTMLElement>(
          '[data-ojtrace-record-id="atcoder:13"] .problem strong',
        )?.style.color,
      ).toBe("var(--lfe-color--cyan-3)");
      expect(
        document.querySelector(".row .luogu-username")?.textContent,
      ).toContain("DGFLSzfd");
      expect(
        document.querySelector(".row .luogu-username")?.textContent,
      ).not.toContain("alice");
      expect(
        document
          .querySelector<HTMLAnchorElement>(
            ".row .luogu-username a[href*='/user/']",
          )
          ?.hasAttribute("data-v-12b24cc3"),
      ).toBe(true);
      expect(
        document
          .querySelector<HTMLAnchorElement>(
            ".row .luogu-username a[href*='award-certify']",
          )
          ?.hasAttribute("data-v-12b24cc3"),
      ).toBe(true);
      expect(document.querySelector(".row .metrics .fa-clock")).not.toBeNull();
      const codeSize = document.querySelector(
        ".row .metrics .fa-ruler-combined",
      )?.parentElement;
      expect(codeSize).not.toBeNull();
      expect(codeSize?.textContent?.trim()).toBe(
        codeLength === undefined ? "—" : "20B",
      );
      if (codeLength === undefined)
        expect(codeSize?.title).toContain("暂不可用");
      expect(document.querySelector(".row .fa-file-code")).not.toBeNull();
      expect(
        document.querySelector<HTMLImageElement>(".row .user img.avatar")?.src,
      ).toBe("https://cdn.luogu.com.cn/upload/usericon/981551.png");
      expect(
        document.querySelector<HTMLElement>(".row .status span")?.style,
      ).toMatchObject({
        display: "inline-block",
        padding: "0px 0.5em",
      });
      expect(
        document.querySelector<HTMLElement>(".list-scroll")?.style.overflowX,
      ).toBe("auto");
      expect(
        document.querySelector<HTMLElement>(".list-wrap")?.style.maxWidth,
      ).toBe("100%");

      dispose();
      expect(document.querySelector("[data-ojtrace-cross-oj-rows]")).toBeNull();
      expect(document.querySelector<HTMLElement>(".empty-block")?.hidden).toBe(
        false,
      );
      expect(
        document
          .querySelector<HTMLElement>(".empty-block")
          ?.getAttribute("style"),
      ).toBe("color: blue;");
    },
  );

  it("keeps the original empty state and shows the account setup explanation", async () => {
    nativePage({ empty: true });
    const dispose = mount(async () =>
      response([], "请先在 OJTrace 中配置并启用对应 OJ 账号."),
    );
    await nextMutationTurn();

    expect(document.querySelector(".empty-block")?.textContent).toContain(
      "没有找到结果",
    );
    expect(document.querySelector(".row")).toBeNull();
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")?.textContent,
    ).toContain("配置并启用");
    dispose();
  });

  it("shows a useful request error without touching the original result area", async () => {
    nativePage({ count: 1 });
    const request = vi.fn(async () => {
      throw new Error("permission required");
    });
    const dispose = mount(request);
    await nextMutationTurn();

    expect(request).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(".row")).toHaveLength(1);
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")?.textContent,
    ).toContain("permission required");
    expect(
      document.querySelector("[data-ojtrace-cross-oj-message]")
        ?.previousElementSibling?.textContent,
    ).toBe("隐藏难度");
    expect(
      document.querySelector(".result .actions > button")?.textContent,
    ).toBe("搜索");
    dispose();
  });

  it("leaves official record links to browser navigation for normal and modified clicks", async () => {
    nativePage({ count: 1 });
    const dispose = mount(async () => response([records[0]!]));
    await nextMutationTurn();
    const status = document.querySelector<HTMLAnchorElement>(
      '[data-ojtrace-record-id="codeforces:11"] .status',
    );
    expect(status?.href).toBe(records[0]!.detailUrl);
    const originalUrl = location.href;
    for (const init of [
      { button: 0 },
      { button: 0, ctrlKey: true },
      { button: 1 },
    ]) {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      status!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(location.href).toBe(originalUrl);
    }
    dispose();
  });
});
