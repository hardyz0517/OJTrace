import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { auditArchitecture } from "../../tools/audit-architecture.mjs";

function fixture(files: Record<string, string>): string[] {
  const prefix = join(tmpdir(), "ojtrace-architecture-");
  const root = mkdtempSync(prefix);
  if (!root.startsWith(prefix)) throw new Error("Unexpected fixture path");
  try {
    const sources = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          module: "Preserve",
          moduleResolution: "Bundler",
          paths: { "@/*": ["./*"] },
          noEmit: true,
        },
        include: ["**/*.ts"],
      }),
      "src/adapters/qoj/index.ts":
        "export const adapter = {}; export interface Contract {}",
      "src/application/bridge.ts": 'export { adapter } from "../adapters/qoj";',
      "src/domain/types.ts": "export interface Contract {}",
      ...files,
    };
    for (const [path, body] of Object.entries(sources)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
    return auditArchitecture({ root, project: join(root, "tsconfig.json") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("architecture dependency gate", () => {
  it("follows aliases and transitive re-exports to adapter implementations", () => {
    const errors = fixture({
      "entrypoints/settings/main.ts":
        'import { adapter } from "@/src/application/bridge"; console.log(adapter);',
    });
    expect(
      errors.some((error) =>
        error.includes(
          "entrypoints/settings/main.ts -> src/application/bridge.ts -> src/adapters/qoj/index.ts",
        ),
      ),
    ).toBe(true);
  });
  it("follows literal dynamic imports", () => {
    expect(
      fixture({
        "entrypoints/timeline/main.ts":
          'void import("../../src/adapters/qoj");',
      }).some((error) => error.includes("src/adapters/qoj/index.ts")),
    ).toBe(true);
  });
  it("also rejects a future source implementation without changing the gate", () => {
    expect(
      fixture({
        "src/adapters/new-source/index.ts": "export const adapter = {};",
        "entrypoints/settings/main.ts":
          'export { adapter } from "../../src/adapters/new-source";',
      }).some((error) => error.includes("src/adapters/new-source/index.ts")),
    ).toBe(true);
  });
  it.each([
    'import type { Contract } from "../../src/adapters/qoj";',
    'import { type Contract } from "../../src/adapters/qoj";',
    'export type { Contract } from "../../src/adapters/qoj";',
    'type Module = typeof import("../../src/adapters/qoj");',
  ])("ignores erased imports: %s", (body) => {
    expect(fixture({ "entrypoints/settings/main.ts": body })).toEqual([]);
  });
  it.each([
    'import { missing } from "./missing"; console.log(missing);',
    'const path = "./missing"; void import(path);',
    'import {} from "../../src/adapters/qoj";',
    'import adapter = require("../../src/adapters/qoj"); console.log(adapter);',
  ])("rejects unresolved/dynamic/runtime empty bindings: %s", (body) => {
    expect(
      fixture({ "entrypoints/settings/main.ts": body }).length,
    ).toBeGreaterThan(0);
  });
  it("rejects runtime dependencies and browser APIs in pure modules", () => {
    const errors = fixture({
      "src/sources/definitions.ts":
        'export { adapter } from "../application/bridge";',
      "src/domain/browser.ts": "export const width = window.innerWidth;",
    });
    expect(
      errors.some((error) =>
        error.includes(
          "src/sources/definitions.ts -> src/application/bridge.ts",
        ),
      ),
    ).toBe(true);
    expect(
      errors.some((error) => error.includes("browser global window")),
    ).toBe(true);
  });
  it("allows pure adapter leaves and local variables called window", () => {
    expect(
      fixture({
        "src/adapters/hydroj/leaf.ts": "export const language = 'C++';",
        "entrypoints/settings/main.ts":
          'import { language } from "../../src/adapters/hydroj/leaf"; console.log(language);',
        "src/domain/window.ts":
          "export function size(window: { length: number }) { return window.length; }",
      }),
    ).toEqual([]);
  });
});
