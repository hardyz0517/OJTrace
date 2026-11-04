import { beforeAll } from "vitest";

// jsdom has no layout engine. CodeMirror's scheduled measurements still need
// the Range geometry API; actual typography/layout is verified in the browser.
beforeAll(() => {
  if (!Range.prototype.getBoundingClientRect) {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
  }
  if (!Range.prototype.getClientRects) {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () =>
        Object.assign([new DOMRect()], {
          item: (index: number) => (index === 0 ? new DOMRect() : null),
        }),
    });
  }
});
