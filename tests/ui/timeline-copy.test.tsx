// @vitest-environment jsdom
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../entrypoints/timeline/main";
import type { Submission } from "../../src/domain";
import type { RuntimeMessage } from "../../src/application/messaging/messages";
import { publicStoredData } from "../../src/application/accounts/account-queries";
import { defaultStoredData } from "../../src/application/storage/store";

// The entrypoint mounts itself; each test mounts App in its own root below.
vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));
const { createRoot } =
  await vi.importActual<typeof import("react-dom/client")>("react-dom/client");

const now = new Date(2026, 9, 4, 12).getTime();
const origin = "http://47.113.203.55";
const problemUrl = `${origin}/p/46?tid=6ab4a0ada8d28a785f6d5510`;
const submissionUrl = `${origin}/record/6abbbf64a8d28a785f782f39`;
const firstLine = `- [T18 [CCO 2021] Travelling Merchant](${problemUrl}) [(code)](${submissionUrl})`;

function submission(overrides: Partial<Submission>): Submission {
  return {
    source: "hydroj",
    origin,
    accountId: "hydro",
    submissionId: "first",
    identityQuality: "stable",
    problemId: "T18",
    problemName: "[CCO 2021] Travelling Merchant",
    problemUrl,
    submissionUrl,
    submittedAt: new Date(2026, 8, 27, 18).getTime(),
    verdict: { code: "accepted", raw: "Accepted" },
    fetchedAt: now,
    ...overrides,
  };
}

const submissions = [
  submission({}),
  submission({
    source: "qoj",
    accountId: "qoj",
    submissionId: "other-oj",
    problemId: "Q1",
    problemName: "Other OJ",
    problemUrl: "https://qoj.ac/problem/1",
    submissionUrl: "https://qoj.ac/submission/2",
    submittedAt: new Date(2026, 8, 28, 15).getTime(),
  }),
  submission({
    submissionId: "no-code",
    problemId: "T19",
    problemName: "No code",
    problemUrl: `${origin}/p/47`,
    submissionUrl: undefined,
    fallbackListUrl: `${origin}/record`,
    submittedAt: new Date(2026, 8, 27, 16).getTime(),
  }),
  submission({
    submissionId: "older-attempt",
    submittedAt: new Date(2026, 8, 26, 10).getTime(),
  }),
  submission({
    submissionId: "wrong-answer",
    problemId: "T20",
    problemName: "Wrong answer",
    verdict: { code: "wrong_answer", raw: "Wrong Answer" },
    submittedAt: new Date(2026, 8, 27, 14).getTime(),
  }),
  submission({
    submissionId: "outside-short-range",
    problemId: "T21",
    problemName: "Older problem",
    submittedAt: new Date(2026, 8, 15, 15).getTime(),
  }),
  submission({
    submissionId: "today",
    problemId: "T22",
    problemName: "Today",
    submittedAt: new Date(2026, 9, 4, 10).getTime(),
  }),
  submission({
    submissionId: "future",
    submittedAt: new Date(2026, 9, 5, 10).getTime(),
  }),
  submission({
    submissionId: "outside-default-range",
    submittedAt: new Date(2026, 7, 31, 10).getTime(),
  }),
];

let root: Root;
let container: HTMLDivElement;
const writeText = vi.fn(async (_text: string) => {});
const execCommand = vi.fn(() => true);

async function mount(items = submissions) {
  const data = publicStoredData({
    ...defaultStoredData(),
    submissions: items,
  });
  vi.mocked(browser.runtime.sendMessage).mockImplementation(
    async (raw: unknown) => ({
      schemaVersion: 2,
      type: "STATE",
      requestId: (raw as RuntimeMessage).requestId,
      ok: true,
      data,
    }),
  );
  await act(async () => root.render(createElement(App)));
}

function button(label: string, parent: ParentNode = document) {
  const result = Array.from(
    parent.querySelectorAll<HTMLButtonElement>("button"),
  ).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label ||
      candidate.textContent === label,
  );
  expect(result).toBeDefined();
  return result!;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function select(label: string, option: string) {
  const trigger = button(label);
  await click(trigger);
  await click(button(option, trigger.parentElement!));
}

function toast() {
  return container.querySelector("[role=status]")?.textContent;
}

function shownProblems() {
  return Array.from(container.querySelectorAll(".row .problem-id")).map(
    (element) => element.textContent,
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("browser", {
    runtime: {
      sendMessage: vi.fn(),
      getURL: (path: string) => `https://extension.test${path}`,
    },
  });
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(now);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  writeText.mockResolvedValue(undefined);
  execCommand.mockReturnValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Timeline review copying", () => {
  it("copies every displayed row in date-group order from the left filter controls", async () => {
    await mount();
    const copy = container.querySelector<HTMLButtonElement>(
      ".copy-filtered-button",
    )!;
    expect(copy.closest(".filter-controls")).not.toBeNull();
    expect(copy.closest(".filter-actions")).toBeNull();
    expect(
      copy.previousElementSibling
        ?.querySelector("button")
        ?.getAttribute("aria-label"),
    ).toBe("提交筛选");
    await click(copy);
    const text = writeText.mock.calls[0]![0];
    const lines = text.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe(firstLine);
    expect(lines[1]).toBe(`- [T19 No code](${origin}/p/47)`);
    expect(lines.map((line) => line.match(/^- \[(\w+)/)?.[1])).toEqual(
      shownProblems(),
    );
    expect(execCommand).not.toHaveBeenCalled();
    expect(toast()).toBe("已复制 7 条记录");
  });

  it("respects combined OJ, time, verdict and latest-submission filters for both copy levels", async () => {
    await mount();
    await select("OJ 筛选", "HydroOJ");
    await click(button("时间筛选"));
    await click(button("14d"));
    await click(button("确定"));
    await select("状态筛选", "Accepted");
    await select("提交筛选", "每题最后一次");
    expect(shownProblems()).toEqual(["T18", "T19", "T22"]);
    await click(
      container.querySelector<HTMLButtonElement>(".copy-filtered-button")!,
    );
    expect(writeText.mock.calls[0]![0].split("\n")).toEqual([
      firstLine,
      `- [T19 No code](${origin}/p/47)`,
      `- [T22 Today](${problemUrl}) [(code)](${submissionUrl})`,
    ]);
    expect(toast()).toBe("已复制 3 条记录");

    const day = container.querySelector(".day")!;
    const copyDay = button("复制当天复盘 Markdown", day);
    expect(copyDay.title).toBe("复制当天复盘 Markdown");
    await click(copyDay);
    expect(writeText.mock.calls[1]![0]).toBe(
      `${firstLine}\n- [T19 No code](${origin}/p/47)`,
    );
    expect(toast()).toBe("已复制 9 月 27 日的 2 条记录");

    await select("状态筛选", "Unaccepted");
    expect(shownProblems()).toEqual(["T20"]);
    await click(
      button("复制当天复盘 Markdown", container.querySelector(".day")!),
    );
    expect(writeText.mock.calls[2]![0]).toContain("T20 Wrong answer");
    expect(toast()).toBe("已复制 9 月 27 日的 1 条记录");
  });

  it("disables bulk copy when the current filter has no records", async () => {
    await mount();
    await select("OJ 筛选", "AtCoder");
    const copy = container.querySelector<HTMLButtonElement>(
      ".copy-filtered-button",
    )!;
    expect(copy.disabled).toBe(true);
    expect(container.querySelector(".copy-day-button")).toBeNull();
    await click(copy);
    expect(writeText).not.toHaveBeenCalled();
    expect(toast()).toBeUndefined();
  });

  it("preserves single-row Markdown and its existing success toast", async () => {
    await mount();
    await click(button("复制复盘 Markdown", container.querySelector(".row")!));
    expect(writeText).toHaveBeenCalledWith(firstLine);
    expect(toast()).toBe("已复制");
  });

  it("reuses the clipboard fallback and removes its temporary textarea", async () => {
    await mount();
    writeText.mockRejectedValue(new Error("Clipboard unavailable"));
    let copiedText = "";
    execCommand.mockImplementation(() => {
      copiedText = document.querySelector("textarea")!.value;
      return true;
    });
    await click(
      button("复制当天复盘 Markdown", container.querySelector(".day")!),
    );
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copiedText.split("\n")).toHaveLength(3);
    expect(copiedText.split("\n")[0]).toBe(firstLine);
    expect(document.querySelector("textarea")).toBeNull();
    expect(toast()).toBe("已复制 9 月 27 日的 3 条记录");
  });

  it("reports a failed clipboard fallback without claiming success", async () => {
    await mount();
    writeText.mockRejectedValue(new Error("Clipboard unavailable"));
    execCommand.mockReturnValue(false);
    await click(
      container.querySelector<HTMLButtonElement>(".copy-filtered-button")!,
    );
    expect(toast()).toBe("复制失败，请重试");
    expect(document.querySelector("textarea")).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(".copy-filtered-button")!
        .disabled,
    ).toBe(false);
  });
});
