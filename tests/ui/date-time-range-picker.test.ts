// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTimeRangePicker } from "../../entrypoints/shared/DateTimeRangePicker";
import {
  formatRangeDate,
  formatRangeTime,
  type DateTimeRange,
} from "../../entrypoints/shared/date-time-range";

const now = new Date(2026, 9, 1, 23, 48).getTime();
const original: DateTimeRange = {
  from: new Date(2026, 9, 1, 0, 0).getTime(),
  to: now,
  followNow: false,
};
let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();

function input(label: string): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
  expect(element).not.toBeNull();
  return element!;
}

function button(text: string): HTMLButtonElement {
  const element = Array.from(document.querySelectorAll("button")).find(
    (candidate) =>
      candidate.textContent === text ||
      candidate.getAttribute("aria-label") === text,
  );
  expect(element).toBeDefined();
  return element!;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

async function edit(label: string, value: string): Promise<void> {
  const element = input(label);
  await act(async () => {
    element.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function day(number: number): HTMLButtonElement {
  const element = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".rdp-day:not(.rdp-outside) .rdp-day_button",
    ),
  ).find((candidate) => candidate.textContent === String(number));
  expect(element).toBeDefined();
  return element!;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(now);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(DateTimeRangePicker, { value: original, onChange }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DateTimeRangePicker", () => {
  it("toggles the popover closed after opening", async () => {
    await click(button("时间筛选"));
    expect(
      document.querySelector(".date-range-popover")?.getAttribute("data-state"),
    ).toBe("open");

    await click(button("时间筛选"));
    expect(
      document.querySelector(".date-range-popover")?.getAttribute("data-state"),
    ).toBe("closed");
  });

  it("opens native time menus for each endpoint without committing or selecting a segment", async () => {
    await click(button("时间筛选"));
    for (const label of ["开始时刻", "结束时刻"]) {
      const field = input(label);
      const showPicker = vi.fn();
      Object.defineProperty(field, "showPicker", { value: showPicker });
      await click(button(`选择${label}`));
      expect(showPicker).toHaveBeenCalledOnce();
      expect(document.activeElement).not.toBe(field);
      expect(
        document
          .querySelector(".date-range-popover")
          ?.getAttribute("data-state"),
      ).toBe("open");
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens the date menu without selecting the year in the input", async () => {
    await click(button("时间筛选"));
    const field = input("开始日期");
    await act(async () => field.focus());
    await click(button("选择开始日期"));
    expect(document.activeElement).not.toBe(field);
    expect(
      document
        .querySelector(".date-range-date-menu")
        ?.getAttribute("data-state"),
    ).toBe("open");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the date menu open across month navigation and changes the draft only after choosing a day", async () => {
    await click(button("时间筛选"));
    const field = input("开始日期");
    await click(button("选择开始日期"));
    const menu = document.querySelector<HTMLElement>(".date-range-date-menu")!;

    for (const [selector, month] of [
      [".rdp-button_previous", "2026年9月"],
      [".rdp-button_previous", "2026年8月"],
      [".rdp-button_next", "2026年9月"],
    ] as const) {
      await click(menu.querySelector<HTMLElement>(selector)!);
      expect(menu.querySelector(".rdp-caption_label")?.textContent).toBe(month);
      expect(menu.getAttribute("data-state")).toBe("open");
      expect(field.value).toBe("2026-10-01");
      expect(document.activeElement).not.toBe(field);
    }

    const date = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(
        ".rdp-day:not(.rdp-outside) .rdp-day_button",
      ),
    ).find((day) => day.textContent === "15")!;
    await click(date);
    expect(field.value).toBe("2026-09-15");
    expect(input("开始时刻").value).toBe("00:00");
    expect(menu.getAttribute("data-state")).toBe("closed");
    expect(
      document.querySelector(".date-range-popover")?.getAttribute("data-state"),
    ).toBe("open");
    expect(onChange).not.toHaveBeenCalled();
    await click(button("取消"));
    await click(button("时间筛选"));
    expect(field.value).toBe("2026-10-01");
  });

  it("discards date-menu browsing on Escape while keeping the range picker open", async () => {
    await click(button("时间筛选"));
    await click(button("选择结束日期"));
    const menu = document.querySelector<HTMLElement>(".date-range-date-menu")!;
    await click(menu.querySelector<HTMLElement>(".rdp-button_previous")!);
    await act(async () =>
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(menu.getAttribute("data-state")).toBe("closed");
    expect(
      document.querySelector(".date-range-popover")?.getAttribute("data-state"),
    ).toBe("open");
    expect(input("结束日期").value).toBe("2026-10-01");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("enforces collection bounds in the date menu and preserves the endpoint time", async () => {
    await act(async () =>
      root.render(
        createElement(DateTimeRangePicker, {
          value: original,
          onChange,
          maxLookbackDays: 35,
          disableFuture: true,
        }),
      ),
    );
    await click(button("时间筛选"));
    await click(button("选择结束日期"));
    const menu = document.querySelector<HTMLElement>(".date-range-date-menu")!;
    expect(
      menu.querySelector<HTMLButtonElement>(
        '.rdp-day:not(.rdp-outside) button[aria-label^="2026年10月2日"]',
      )?.disabled,
    ).toBe(true);
    await click(menu.querySelector<HTMLElement>(".rdp-button_previous")!);
    const date = menu.querySelector<HTMLButtonElement>(
      'button[aria-label^="2026年9月30日"]',
    )!;
    await click(date);
    expect(input("结束日期").value).toBe("2026-09-30");
    expect(input("结束时刻").value).toBe("23:48");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("limits collection dates to the last 35 days and blocks future times", async () => {
    await act(async () =>
      root.render(
        createElement(DateTimeRangePicker, {
          value: original,
          onChange,
          ariaLabel: "选择采集范围",
          maxLookbackDays: 35,
          disableFuture: true,
        }),
      ),
    );
    await click(button("选择采集范围"));
    expect(document.querySelector(".date-range-caption")?.textContent).toBe(
      "支持日期与时间",
    );
    expect(day(2).disabled).toBe(true);
    expect(day(1).disabled).toBe(false);
    await click(button("上个月"));
    await click(button("上个月"));
    expect(day(26).disabled).toBe(true);
    expect(day(27).disabled).toBe(false);

    await edit("开始日期", "2026-08-27");
    await edit("开始时刻", "23:47");
    expect(button("确定").disabled).toBe(true);
    expect(document.querySelector(".date-range-caption")?.textContent).toBe(
      "最多回溯最近 35 天",
    );
    await edit("开始时刻", "23:48");
    expect(button("确定").disabled).toBe(false);

    await edit("结束时刻", "23:49");
    expect(button("确定").disabled).toBe(true);
    expect(document.querySelector(".date-range-caption")?.textContent).toBe(
      "不能选择未来时间",
    );
    await edit("结束日期", "2026-10-02");
    await edit("结束时刻", "00:00");
    expect(button("确定").disabled).toBe(true);
    await click(button("30d"));
    expect(button("确定").disabled).toBe(false);
    await click(button("确定"));
    expect(onChange).toHaveBeenCalledWith({
      from: now - 30 * 86_400_000,
      to: now,
      followNow: false,
      preset: 30,
    });
  });

  it("keeps precise shortcut bounds valid when the current clock has seconds", async () => {
    const clockWithSeconds = now + 45_000;
    vi.setSystemTime(clockWithSeconds);
    await act(async () =>
      root.render(
        createElement(DateTimeRangePicker, {
          value: original,
          onChange,
          maxLookbackDays: 35,
          disableFuture: true,
        }),
      ),
    );
    await click(button("时间筛选"));
    await click(button("7d"));
    expect(button("确定").disabled).toBe(false);
    await click(button("确定"));
    expect(onChange).toHaveBeenCalledWith({
      from: clockWithSeconds - 7 * 86_400_000,
      to: clockWithSeconds,
      followNow: false,
      preset: 7,
    });
  });

  it("keeps the timeline's year and all-local shortcuts available", async () => {
    await act(async () =>
      root.render(
        createElement(DateTimeRangePicker, {
          value: original,
          onChange,
          additionalPresets: [
            { label: "最近一年", preset: 365 },
            { label: "全部本地记录", preset: 36500 },
          ],
        }),
      ),
    );
    await click(button("时间筛选"));
    await click(button("最近一年"));
    expect(input("开始日期").value).toBe(
      formatRangeDate(now - 365 * 86_400_000).replaceAll("/", "-"),
    );
    await click(button("全部本地记录"));
    await click(button("确定"));
    expect(onChange).toHaveBeenCalledWith({
      from: 0,
      to: now,
      followNow: false,
      preset: 36500,
    });
  });
  it("opens with the current range and cancels every draft change", async () => {
    await click(button("时间筛选"));
    expect(input("开始日期").value).toBe("2026-10-01");
    expect(input("开始时刻").value).toBe("00:00");
    await click(button("7d"));
    await click(document.querySelector<HTMLElement>("[role=checkbox]")!);
    await click(button("取消"));
    expect(onChange).not.toHaveBeenCalled();
    await click(button("时间筛选"));
    expect(input("开始日期").value).toBe("2026-10-01");
    expect(input("结束时刻").value).toBe("23:48");
    expect(
      document.querySelector("[role=checkbox]")?.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("opens the calendar at the range start and keeps the full selected run visible", async () => {
    await act(async () =>
      root.render(
        createElement(DateTimeRangePicker, {
          value: {
            from: new Date(2026, 8, 29, 0, 0).getTime(),
            to: new Date(2026, 9, 3, 23, 48).getTime(),
            followNow: false,
          },
          onChange,
        }),
      ),
    );
    await click(button("时间筛选"));
    expect(document.querySelector(".rdp-caption_label")?.textContent).toBe(
      "2026年9月",
    );
    expect(document.querySelectorAll(".rdp-range_middle").length).toBe(3);
  });

  it("updates every shortcut immediately and commits only on confirmation", async () => {
    await click(button("时间筛选"));
    for (const [label, days] of [
      ["1d", 1],
      ["7d", 7],
      ["14d", 14],
      ["30d", 30],
    ] as const) {
      await click(button(label));
      expect(input("开始日期").value).toBe(
        formatRangeDate(now - days * 86_400_000).replaceAll("/", "-"),
      );
      expect(input("开始时刻").value).toBe("23:48");
      expect(button(label).getAttribute("aria-pressed")).toBe("true");
    }
    await click(button("今天"));
    expect(input("开始时刻").value).toBe("00:00");
    expect(onChange).not.toHaveBeenCalled();
    await click(button("确定"));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ ...original, preset: "today" });
  });

  it("opens a rolling shortcut at its start month", async () => {
    await click(button("时间筛选"));
    await click(button("30d"));
    expect(document.querySelector(".rdp-caption_label")?.textContent).toBe(
      "2026年9月",
    );
  });

  it("blocks incomplete native date/time input and reversed bounds", async () => {
    await click(button("时间筛选"));
    await edit("开始时刻", "09:");
    expect(input("开始时刻").value).toBe("");
    expect(button("确定").disabled).toBe(true);
    await edit("开始时刻", "09:15");
    expect(button("确定").disabled).toBe(false);
    await edit("开始日期", "2026-02-30");
    expect(input("开始日期").value).toBe("");
    expect(button("确定").disabled).toBe(true);
    await edit("开始日期", "2026-10-01");
    await edit("结束时刻", "24:00");
    expect(button("确定").disabled).toBe(true);
    await edit("结束时刻", "08:00");
    expect(button("确定").disabled).toBe(true);
    await edit("结束时刻", "10:45");
    await click(button("确定"));
    expect(onChange).toHaveBeenCalledWith({
      from: new Date(2026, 9, 1, 9, 15).getTime(),
      to: new Date(2026, 9, 1, 10, 45).getTime(),
      followNow: false,
      preset: undefined,
    });
  });

  it("selects a range across months and keeps endpoint times", async () => {
    await click(button("时间筛选"));
    await click(button("上个月"));
    await click(day(29));
    await click(button("下个月"));
    await click(day(3));
    expect(input("开始日期").value).toBe("2026-09-29");
    expect(input("结束日期").value).toBe("2026-10-03");
    expect(input("开始时刻").value).toBe("00:00");
    expect(input("结束时刻").value).toBe("23:48");
    expect(document.querySelectorAll(".rdp-range_middle").length).toBe(3);
    await click(button("确定"));
    expect(onChange).toHaveBeenCalledWith({
      from: new Date(2026, 8, 29, 0, 0).getTime(),
      to: new Date(2026, 9, 3, 23, 48).getTime(),
      followNow: false,
    });
  });

  it("supports selecting a single day or picking dates in reverse order", async () => {
    await click(button("时间筛选"));
    await click(day(10));
    await click(day(5));
    expect(input("开始日期").value).toBe("2026-10-05");
    expect(input("结束日期").value).toBe("2026-10-10");
    await click(day(12));
    await click(day(12));
    expect(input("开始日期").value).toBe("2026-10-12");
    expect(input("结束日期").value).toBe("2026-10-12");
    expect(button("确定").disabled).toBe(false);
  });

  it("updates the following end across midnight and persists it on confirmation", async () => {
    await click(button("时间筛选"));
    await click(document.querySelector<HTMLElement>("[role=checkbox]")!);
    expect(input("结束时刻").disabled).toBe(true);
    expect(button("选择结束日期").disabled).toBe(true);
    expect(button("选择结束时刻").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(13 * 60_000));
    expect(input("结束日期").value).toBe("2026-10-02");
    expect(input("结束时刻").value).toBe("00:01");
    expect(input("开始日期").value).toBe("2026-10-01");
    expect(onChange).not.toHaveBeenCalled();
    await click(button("确定"));
    expect(onChange).toHaveBeenCalledWith({
      ...original,
      to: now + 13 * 60_000,
      followNow: true,
    });
  });

  it("keeps committed follow mode on reopening and resets it on cancel", async () => {
    await act(async () =>
      root.render(
        createElement(DateTimeRangePicker, {
          value: { ...original, followNow: true },
          onChange,
        }),
      ),
    );
    await click(button("时间筛选"));
    expect(input("结束时刻").disabled).toBe(true);
    await click(document.querySelector<HTMLElement>("[role=checkbox]")!);
    await click(button("取消"));
    await click(button("时间筛选"));
    expect(input("结束时刻").disabled).toBe(true);
  });

  it("discards a draft on Escape and restores focus to the trigger", async () => {
    await click(button("时间筛选"));
    await click(button("14d"));
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onChange).not.toHaveBeenCalled();
    await click(button("时间筛选"));
    expect(input("开始日期").value).toBe(
      formatRangeDate(original.from).replaceAll("/", "-"),
    );
    expect(input("开始时刻").value).toBe(formatRangeTime(original.from));
  });
});
