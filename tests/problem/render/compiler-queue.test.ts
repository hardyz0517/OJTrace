import { describe, expect, it } from "vitest";
import { BrowserTypstCompiler } from "../../../src/problem/render/browser-typst-compiler";

describe("browser typst compiler queue", () => {
  it("does not interleave shadow operations across compiles", async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstPdf = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const api = {
      async resetShadow() {
        events.push("reset");
      },
      async mapShadow() {
        events.push("map");
      },
      async pdf() {
        events.push("pdf");
        if (events.filter((event) => event === "pdf").length === 1)
          await firstPdf;
        return new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
      },
      use() {},
    };
    const compiler = new BrowserTypstCompiler(
      api as unknown as ConstructorParameters<typeof BrowserTypstCompiler>[0],
    );
    const first = compiler.compile("first");
    const second = compiler.compile("second");
    for (let turn = 0; turn < 20 && !events.includes("pdf"); turn += 1)
      await Promise.resolve();
    expect(events).toEqual(["reset", "map", "pdf"]);

    const observed = await Promise.race([
      first.then(() => "pdf"),
      Promise.resolve("timeout"),
    ]);
    expect(observed).toBe("timeout");
    expect(events).toEqual(["reset", "map", "pdf"]);

    releaseFirst?.();
    await first;
    await second;
    expect(events).toEqual([
      "reset",
      "map",
      "pdf",
      "reset",
      "reset",
      "map",
      "pdf",
      "reset",
    ]);
    expect(events.indexOf("map", 4)).toBeGreaterThan(
      events.indexOf("reset", 3),
    );
  });
});
