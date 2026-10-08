// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaginationSettings } from "../../entrypoints/settings/PaginationSettings";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import { defaultStoredData } from "../../src/application/storage/store";
import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../../src/application/messaging/messages";
import type { SourceId, StoredData } from "../../src/domain";
import { instanceBrandingKey } from "../../src/domain/account-identity";
import { accountRecord } from "../account-fixture";

const now = 700_000;
const hydroOrigin = "https://pagination.example.org";
const sources = [
  { source: "codeforces", name: "Codeforces", pages: 2, records: 2 },
  { source: "luogu", name: "洛谷", pages: 2, records: 2 },
  { source: "qoj", name: "QOJ", pages: 2, records: 2 },
  { source: "atcoder", name: "AtCoder", pages: 2, records: 501 },
  { source: "hydroj", name: "HydroOJ", pages: 3, records: 1 },
] as const;
type SourceCase = (typeof sources)[number];
type MessageListener = (
  message: unknown,
  sender: { id: string },
) => RuntimeResponse | Promise<RuntimeResponse> | undefined;

let root: Root | undefined;
let container: HTMLDivElement;
let stored: StoredData;
let listener: MessageListener;
let pages: Array<{ url: string; at: number }>;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}
function html(text: string): Response {
  return new Response(text, { headers: { "content-type": "text/html" } });
}
function atcoderRow(id: number, seconds: number) {
  return {
    id,
    epoch_second: seconds,
    contest_id: "abc1",
    problem_id: "abc1_a",
    language: "C++",
    point: 100,
    result: "AC",
  };
}

// Only external browser APIs/network responses are simulated. Settings, message
// routing, storage, sync, adapters, HTTP and the real delay timers all execute.
function siteResponse(source: SourceId, url: URL): Response {
  if (source === "codeforces") {
    pages.push({ url: url.href, at: Date.now() });
    return json({
      status: "OK",
      result: [
        {
          id: 1,
          creationTimeSeconds: 30,
          problem: { index: "A", contestId: 1 },
          verdict: "OK",
        },
      ],
    });
  }
  if (source === "luogu") {
    pages.push({ url: url.href, at: Date.now() });
    const page = Number(url.searchParams.get("page"));
    return json({
      data: {
        user: { uid: "tester", name: "tester" },
        records: {
          count: 2,
          perPage: 1,
          result: [
            {
              id: page,
              submitTime: 31 - page,
              status: 12,
              problem: { pid: "P1001" },
            },
          ],
        },
      },
    });
  }
  if (source === "qoj") {
    pages.push({ url: url.href, at: Date.now() });
    const page = Number(url.searchParams.get("page") ?? "1");
    return html(
      `<html><title>Submissions</title><ul class="nav"><span class="uoj-username" data-link="0">tester</span><a href="/logout">Logout</a></ul><table><tbody><tr><td><a href="/submission/${page}">#${page}</a></td><td><a href="/problem/1">A</a></td><td>tester</td><td>AC</td><td>1ms</td><td>1kb</td><td>C++</td><td>1kb</td><td>${31 - page}</td></tr></tbody></table>${page === 1 ? '<ul class="pagination"><li><a href="/submissions?submitter=tester&amp;page=2">2</a></li></ul>' : ""}</html>`,
    );
  }
  if (source === "atcoder") {
    if (url.pathname.includes("user/submissions")) {
      pages.push({ url: url.href, at: Date.now() });
      return json(
        url.searchParams.get("from_second") === "0"
          ? Array.from({ length: 500 }, (_, index) =>
              atcoderRow(index + 1, index + 20),
            )
          : [atcoderRow(500, 519), atcoderRow(501, 520)],
      );
    }
    if (url.pathname.endsWith("problems.json")) return json([]);
    // Optional detail enrichment is outside list pagination.
    return new Response("Unavailable detail", { status: 403 });
  }
  if (url.pathname.endsWith("/record")) {
    pages.push({ url: url.href, at: Date.now() });
    const page = Number(url.searchParams.get("page"));
    return json({
      page,
      rdocs:
        page === 1
          ? [{ _id: "000001f40000000000000001", uid: 42, pid: 1, status: 1 }]
          : [],
    });
  }
  if (url.pathname.includes("/user/")) {
    pages.push({ url: url.href, at: Date.now() });
    return json({ tdocs: [] });
  }
  return html(
    '<script>window.UserContext = \'{"_id":42,"uname":"tester"}\';</script>',
  );
}

async function send(message: RuntimeMessage): Promise<RuntimeResponse> {
  return browser.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}

async function setup(testCase: SourceCase, random = 0.5) {
  vi.spyOn(Math, "random").mockReturnValue(random);
  const account = accountRecord({
    source: testCase.source,
    accountId: "first",
    providerAccountKey: testCase.source === "hydroj" ? "42" : "tester",
    enabled: true,
    authMode:
      testCase.source === "codeforces" ? "public-handle" : "browser-session",
    ...(testCase.source === "hydroj" ? { origin: hydroOrigin } : {}),
  });
  stored = {
    ...defaultStoredData(),
    accounts:
      testCase.source === "codeforces"
        ? [
            account,
            accountRecord({
              ...account,
              accountId: "second",
              providerAccountKey: "other",
            }),
          ]
        : [account],
    ...(testCase.source === "hydroj"
      ? {
          instanceBranding: {
            [instanceBrandingKey("hydroj", hydroOrigin)]: {
              source: "hydroj",
              origin: hydroOrigin,
              name: "Test Hydro",
              fetchedAt: now,
            },
          },
        }
      : {}),
  };
  vi.stubGlobal("browser", {
    action: { onClicked: { addListener: vi.fn() } },
    storage: {
      local: {
        get: async () => ({ "ojtrace:data": structuredClone(stored) }),
        set: async (value: Record<string, StoredData>) => {
          stored = structuredClone(value["ojtrace:data"]!);
        },
      },
      session: { get: async () => ({}), set: async () => undefined },
    },
    cookies: { get: async () => null, getAll: async () => [] },
    runtime: {
      id: "pagination-integration",
      getURL: (path: string) => path,
      getPlatformInfo: vi.fn(async () => ({ os: "win" })),
      onMessage: {
        addListener: (callback: MessageListener) => {
          listener = callback;
        },
      },
      sendMessage: vi.fn(async (message: unknown) =>
        listener(message, { id: "pagination-integration" }),
      ),
    },
  });
  vi.stubGlobal("defineBackground", (main: () => void) => main());
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
    siteResponse(testCase.source, new URL(String(url))),
  );
  await import("../../entrypoints/background");

  function Settings() {
    const [data, setData] = useState(publicStoredData(stored));
    return createElement(PaginationSettings, {
      preferences: data.preferences,
      onUpdated: async () => {
        // Re-read persisted state, just as the actual Settings page does.
        const response = await send({
          schemaVersion: 2,
          type: "GET_STATE",
          requestId: "refresh",
        });
        if (response.ok && response.type === "STATE") setData(response.data);
      },
    });
  }
  root = createRoot(container);
  await act(async () => root!.render(createElement(Settings)));
}

function form(testCase: SourceCase): HTMLFormElement {
  return container.querySelector<HTMLFormElement>(
    `form[aria-label="${testCase.name} 采集节奏"]`,
  )!;
}
async function saveFromSettings(
  testCase: SourceCase,
  interval: string,
  jitter: string,
) {
  await act(async () => {
    const fields = form(testCase).querySelectorAll("input");
    for (const [index, value] of [interval, jitter].entries()) {
      const field = fields[index]!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  const save = form(testCase).querySelector<HTMLButtonElement>(
    'button[aria-label="保存"]',
  )!;
  expect(save.disabled).toBe(false);
  await act(async () => save.click());
  expect(form(testCase).querySelector('[role="alert"]')).toBeNull();
  expect(save.disabled).toBe(true);
}
function sync(): Promise<RuntimeResponse> {
  return send({
    schemaVersion: 2,
    type: "SYNC_REQUEST",
    requestId: crypto.randomUUID(),
    force: true,
    since: 0,
    until: now,
  });
}
function expectCollected(response: RuntimeResponse, testCase: SourceCase) {
  expect(response.ok).toBe(true);
  if (!response.ok || response.type !== "SYNC_RESULT")
    throw new Error("Expected sync result");
  expect(response.result.addedRecords).toBe(testCase.records);
  expect(
    response.result.progress.every(
      (progress) => progress.status === "complete",
    ),
  ).toBe(true);
  expect(stored.submissions).toHaveLength(testCase.records);
  expect(vi.getTimerCount()).toBe(0);
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pages = [];
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Settings -> background -> persisted policy -> real collection -> timed HTTP dispatch", () => {
  it.each(sources)(
    "$name uses the saved interval before real list requests",
    async (testCase) => {
      await setup(testCase);
      await saveFromSettings(testCase, "3.2", "0");
      expect(stored.preferences.paginationBySource?.[testCase.source]).toEqual({
        intervalMs: 3_200,
        jitterMs: 0,
      });
      const operation = sync();
      await vi.advanceTimersByTimeAsync(0);
      expect(pages).toHaveLength(1);
      for (let count = 1; count < testCase.pages; count++) {
        await vi.advanceTimersByTimeAsync(3_199);
        expect(pages).toHaveLength(count);
        await vi.advanceTimersByTimeAsync(1);
        expect(pages).toHaveLength(count + 1);
      }
      expect(pages.map((page) => page.at - now)).toEqual(
        Array.from({ length: testCase.pages }, (_, index) => index * 3_200),
      );
      expectCollected(await operation, testCase);
    },
  );

  it.each(
    sources.flatMap((testCase) =>
      [0, 1].map((random) => ({ ...testCase, random })),
    ),
  )(
    "$name applies saved jitter at random=$random to actual dispatch times",
    async (testCase) => {
      await setup(testCase, testCase.random);
      await saveFromSettings(testCase, "3.2", "0.8");
      const operation = sync();
      const delay = testCase.random === 0 ? 2_400 : 4_000;
      await vi.advanceTimersByTimeAsync(delay * (testCase.pages - 1));
      expect(pages.map((page) => page.at - now)).toEqual(
        Array.from({ length: testCase.pages }, (_, index) => index * delay),
      );
      expectCollected(await operation, testCase);
    },
  );

  it("keeps the running real Luogu collection on its snapshot and applies a new policy next time", async () => {
    const testCase = sources[1];
    await setup(testCase);
    await saveFromSettings(testCase, "3.2", "0");
    const first = sync();
    await vi.advanceTimersByTimeAsync(0);
    await saveFromSettings(testCase, "5", "0");
    await vi.advanceTimersByTimeAsync(3_200);
    expectCollected(await first, testCase);
    const second = sync();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(pages).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(pages.map((page) => page.at - now)).toEqual([
      0, 3_200, 8_200, 13_200,
    ]);
    const response = await second;
    expect(
      response.ok &&
        response.type === "SYNC_RESULT" &&
        response.result.addedRecords,
    ).toBe(0);
    expect(stored.preferences.paginationBySource?.luogu?.intervalMs).toBe(
      5_000,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restoring defaults in Settings also restores the collector's actual delay", async () => {
    const testCase = sources[1];
    await setup(testCase);
    await saveFromSettings(testCase, "5", "0");
    await act(async () =>
      form(testCase)
        .querySelector<HTMLButtonElement>('button[aria-label="恢复默认"]')!
        .click(),
    );
    expect(stored.preferences.paginationBySource).toBeUndefined();
    const operation = sync();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(pages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pages.map((page) => page.at - now)).toEqual([0, 1_500]);
    expectCollected(await operation, testCase);
  });

  it("honors the full 600-second setting before dispatch, below the 15-minute deadline", async () => {
    const testCase = sources[1];
    await setup(testCase);
    await saveFromSettings(testCase, "600", "0");
    const operation = sync();
    await vi.advanceTimersByTimeAsync(599_999);
    expect(pages).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pages.map((page) => page.at - now)).toEqual([0, 600_000]);
    expectCollected(await operation, testCase);
  });
});
