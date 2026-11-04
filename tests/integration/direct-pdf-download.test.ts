import { cnoiFixture } from "../problem/source-test-helpers";
import { parseProblemMarkdown } from "../../src/problem/problem-markdown";
import { sourceFixture } from "../problem/source-test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderDocument } from "../../src/problem/domain";
import {
  PDF_WORKER_ALIVE,
  PDF_WORKER_TARGET,
} from "../../src/application/problem-export/pdf-worker-messages";

const document: RenderDocument = {
  oj: "luogu",
  problemId: "P1001",
  title: "A+B",
  originalUrl: "https://www.luogu.com.cn/problem/P1001",
  ast: {
    type: "root" as const,
    children: [
      { type: "paragraph", children: [{ type: "text", value: "求和" }] },
    ],
  },

  assets: [],
  warnings: [],
};
const mocks = vi.hoisted(() => ({ render: vi.fn(), extract: vi.fn() }));
vi.mock("../../src/problem/registry", () => ({
  problemAdapterRegistry: { inspect: vi.fn(), extractSource: mocks.extract },
}));
vi.mock("../../src/problem/render/worker-problem-renderer", () => ({
  WorkerProblemRenderer: class {
    pdf = mocks.render;
    dispose = vi.fn();
  },
}));

type Sender = { id: string; url: string; tab?: { id: number } };
type Listener = (raw: unknown, sender: Sender) => unknown;
type Delta = { id: number; state?: { current: string } };
let listeners: Listener[];
let changes: Set<(delta: Delta) => void>;
let values: Record<string, unknown>;
const id = "direct-pdf-integration";
const sender = { id, url: `chrome-extension://${id}/background.js` };
const url = `blob:chrome-extension://${id}/pdf-file`;
const api = {
  storage: {
    local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    session: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
  },
  runtime: {
    id,
    getURL: (path: string) => `chrome-extension://${id}${path}`,
    getContexts: vi.fn(async () => []),
    onMessage: {
      addListener: (listener: Listener) => listeners.push(listener),
    },
    onConnect: { addListener: vi.fn() },
    sendMessage: vi.fn(async (raw: unknown) => {
      for (const listener of listeners) {
        const result = listener(raw, sender);
        if (result !== undefined) return await result;
      }
      throw new Error("No runtime receiver");
    }),
  },
  offscreen: {
    createDocument: vi.fn(async () => {
      await import("../../entrypoints/pdf-worker/main");
    }),
    closeDocument: vi.fn(async () => {}),
  },
  scripting: {
    executeScript: vi.fn(async () => [
      {
        result: {
          url: document.originalUrl,
          title: document.title,
          baseUrl: document.originalUrl,
          html: "<main>题面</main>",
          htmlFragment: "<main>题面</main>",
          truncated: false,
        },
      },
    ]),
  },
  tabs: {
    get: vi.fn(async () => ({ id: 7, url: document.originalUrl })),
    create: vi.fn(async () => ({ id: 8 })),
  },
  downloads: {
    download: vi.fn(async () => 42),
    search: vi.fn(async () => [{ state: "complete" }]),
    cancel: vi.fn(async () => {}),
    onChanged: {
      addListener: (listener: (delta: Delta) => void) => changes.add(listener),
      removeListener: (listener: (delta: Delta) => void) =>
        changes.delete(listener),
    },
  },
};
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  listeners = [];
  changes = new Set();
  values = {};
  for (const area of [api.storage.local, api.storage.session]) {
    area.get.mockImplementation(async (key: string | null) =>
      key === null ? { ...values } : { [key]: values[key] },
    );
    area.set.mockImplementation(async (next: Record<string, unknown>) => {
      Object.assign(values, next);
    });
    area.remove.mockImplementation(async (key: string | string[]) => {
      for (const item of Array.isArray(key) ? key : [key]) delete values[item];
    });
  }
  mocks.render.mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]));
  mocks.extract.mockResolvedValue({
    ok: true,
    source: sourceFixture(document),
  });
  vi.stubGlobal("browser", api);
  vi.stubGlobal("window", { setInterval, addEventListener: vi.fn() });
  vi.stubGlobal("defineBackground", (main: () => void) => main());
  vi.spyOn(URL, "createObjectURL").mockReturnValue(url);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  await import("../../entrypoints/background");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function start() {
  return api.runtime.sendMessage({
    schemaVersion: 2,
    requestId: "download-request",
    type: "START_PROBLEM_EXPORT",
    tabId: 7,
    expectedUrl: document.originalUrl,
    intent: "download",
  });
}

describe("background to offscreen direct download", () => {
  it("routes rendering to the offscreen listener and only completes after the download, with no visible page", async () => {
    api.downloads.search.mockResolvedValueOnce([{ state: "in_progress" }]);
    const outcome = start();
    await vi.waitFor(() => expect(api.downloads.search).toHaveBeenCalled());
    expect(mocks.extract).toHaveBeenCalledTimes(1);
    const prepared = cnoiFixture(document);
    const parsed = parseProblemMarkdown(prepared.cnoiMarkdown, prepared);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(mocks.render).toHaveBeenCalledWith(parsed.value);
    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(api.offscreen.closeDocument).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(
      listeners[0]!({ target: PDF_WORKER_TARGET }, sender),
    ).toBeUndefined();
    await expect(
      listeners[0]!(
        { type: PDF_WORKER_ALIVE },
        { id, url: `chrome-extension://${id}/pdf-worker.html` },
      ),
    ).resolves.toEqual({ ok: true });
    for (const listener of changes)
      listener({ id: 42, state: { current: "complete" } });
    await expect(outcome).resolves.toMatchObject({
      ok: true,
      type: "EXPORT_STARTED",
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url);
    expect(api.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    expect(changes.size).toBe(0);
    expect(values).toEqual({});
  });

  it("returns a compiler diagnostic to the popup and closes the hidden context without a download", async () => {
    mocks.render.mockRejectedValueOnce(new Error("font load failed"));
    await expect(start()).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("font load failed") },
    });
    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(api.downloads.download).not.toHaveBeenCalled();
    expect(api.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    expect(values).toEqual({});
  });
});
