// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedSelect } from "../../entrypoints/shared/AnimatedSelect";

const options = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
];
let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

async function render(value = "one") {
  await act(async () =>
    root.render(
      createElement(AnimatedSelect, {
        label: "Choose",
        value,
        options,
        onChange,
      }),
    ),
  );
}

function trigger() {
  return container.querySelector<HTMLButtonElement>(".select-trigger")!;
}

async function key(key: string) {
  await act(async () =>
    trigger().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    ),
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  onChange.mockReset();
});

describe("shared animated select", () => {
  it("keeps closed options out of the tab order and commits a keyboard selection", async () => {
    const choices = Array.from(
      container.querySelectorAll<HTMLButtonElement>("[role=option]"),
    );
    expect(choices.every((option) => option.tabIndex === -1)).toBe(true);
    await key("ArrowDown");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(choices[1]?.classList.contains("is-active")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    await key("Enter");
    expect(onChange).toHaveBeenCalledWith("two");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(choices.every((option) => option.tabIndex === -1)).toBe(true);
  });

  it("closes on Escape and outside clicks without committing a value", async () => {
    await key("Enter");
    await key("Escape");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await key("Enter");
    await act(async () =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tracks controlled value changes and wraps keyboard navigation", async () => {
    await render("three");
    expect(trigger().textContent).toBe("Three");
    await key("ArrowDown");
    await key(" ");
    expect(onChange).toHaveBeenLastCalledWith("one");
  });
});
