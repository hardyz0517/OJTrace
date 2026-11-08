// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.luogu.com.cn/record/list?pid=CF1A&user=981551"}
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountLuoguCrossOjRecordList as mountNativeRecordList } from "../../src/oj-enhancer/features/cross-oj-submit/record-list";
import type {
  CrossOjProblemRef,
  CrossOjRecordListItem,
  CrossOjResponse,
} from "../../src/oj-enhancer/features/cross-oj-submit/model";

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
  );
  disposers.push(dispose);
  return dispose;
}

function nativePage(input: { empty?: boolean; count?: number } = {}): void {
  document.body.innerHTML = `
    <div class="main-container">
      <main class="main-content">
        <div class="l-card">
          <div class="result"><span class="count">共计 <span class="number">${input.count ?? 0}</span> 条结果 <a href="javascript:void(0)">隐藏难度</a></span><button>搜索</button></div>
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
                      <div data-v-ac22f036="" data-v-84064f0e-s=""><div class="detail" data-v-ac22f036="" data-v-84064f0e-s=""><div class="metrics" data-v-ac22f036=""><svg class="metric-icon" viewBox="0 0 1 1"><path d="M0 0h1v1H0z" /></svg></div></div></div>
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
): CrossOjResponse {
  return {
    schemaVersion: 1,
    requestId: "unused",
    ok: true,
    code: "records-loaded",
    records: value,
    ...(recordsMessage ? { recordsMessage } : {}),
  };
}

async function nextMutationTurn(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  document.head
    .querySelectorAll("style[data-test-native-record-styles]")
    .forEach((node) => node.remove());
  document.body.replaceChildren();
  Reflect.deleteProperty(globalThis, "browser");
});

describe("Luogu native cross-OJ record rows", () => {
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
    const olderRecord = { ...records[1]!, submissionId: "13" };
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
    expect(refresh.mock.calls.map((call) => call[0])).toEqual([
      undefined,
      true,
    ]);
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
    expect(document.querySelector(".result > button")).toBe(searchButton);
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
    expect(
      document.querySelector(
        '[data-ojtrace-record-id="codeforces:11"] .detail .fa-file-code',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector<HTMLAnchorElement>(
        '[data-ojtrace-record-id="codeforces:11"] .status',
      )?.href,
    ).toBe(
      "https://www.luogu.com.cn/record/list?pid=CF1A&user=981551#ojtrace-record=cf/11",
    );
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

  it("uses Luogu's loaded component scopes when the native result is empty", async () => {
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
      codeLength: 20,
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
      async () => response([atcoderRecord]),
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
      document.querySelector<HTMLAnchorElement>(".row .problem a")?.href,
    ).toBe("https://www.luogu.com.cn/problem/AT_abc175_f");
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
  });

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
    expect(document.querySelector(".result > button")?.textContent).toBe(
      "搜索",
    );
    dispose();
  });

  it("adopts the fake Luogu record URL without a full document navigation", async () => {
    nativePage({ count: 1 });
    const dispose = mount(async () => response([records[0]!]));
    await nextMutationTurn();
    const status = document.querySelector<HTMLAnchorElement>(
      '[data-ojtrace-record-id="codeforces:11"] .status',
    );
    expect(status?.href).toBe(
      "https://www.luogu.com.cn/record/list?pid=CF1A&user=981551#ojtrace-record=cf/11",
    );
    status?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(location.href).toBe(
      "https://www.luogu.com.cn/record/list?pid=CF1A&user=981551#ojtrace-record=cf/11",
    );
    dispose();
  });
});
