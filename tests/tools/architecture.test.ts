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
        include: ["**/*.ts", "**/*.tsx"],
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

describe("problem pipeline dependency gate", () => {
  it("does not allow a test-only fixture back into the production pipeline", () => {
    const errors = fixture({
      "tests/problem/snapshot-fixtures.ts":
        "export const createSnapshot=()=>({});",
      "src/problem/adapters/luogu.ts":
        'export {createSnapshot} from "../../../tests/problem/snapshot-fixtures";',
    });
    expect(
      errors.some((error) =>
        error.includes(
          "src/problem/adapters/luogu.ts -> tests/problem/snapshot-fixtures.ts",
        ),
      ),
    ).toBe(true);
  });
  it.each([
    [
      "src/problem/markdown/parse.ts",
      'export {rule} from "../cnoi/rules/luogu";',
    ],
    [
      "src/problem/markdown/serialize.ts",
      'export {adapter} from "../adapters/luogu";',
    ],
    [
      "src/problem/render/markdown-to-typst.ts",
      'export {rule} from "../cnoi/rules/luogu";',
    ],
    [
      "src/problem/cnoi/transform.ts",
      'import {render} from "../render/browser-typst-compiler"; export const transform=render;',
    ],
    [
      "src/problem/extract/codec.ts",
      'export {adapter} from "../adapters/luogu";',
    ],
    [
      "src/problem/render/template.ts",
      'export {rule} from "../cnoi/rules/luogu";',
    ],
    [
      "src/problem/adapters/luogu.ts",
      'export {rule} from "../cnoi/rules/luogu";',
    ],
    [
      "entrypoints/problem-export/main.ts",
      'export {adapter} from "../../src/problem/adapters/luogu";',
    ],
    [
      "entrypoints/problem-export/ProblemStudio.tsx",
      'export {rule} from "../../src/problem/cnoi/rules/luogu";',
    ],
    ["src/problem/cnoi/rules/luogu.ts", "export const rule=window.location;"],
  ])("rejects reversed dependencies from %s", (path, body) => {
    expect(
      fixture({
        "src/problem/adapters/luogu.ts": "export const adapter={};",
        "src/problem/cnoi/rules/luogu.ts": "export const rule=()=>{};",
        "src/problem/render/browser-typst-compiler.ts":
          "export const render=()=>{};",
        [path]: body,
      }).length,
    ).toBeGreaterThan(0);
  });
  it("allows pure codecs/shared HTML utilities and parser-driven rendering", () => {
    expect(
      fixture({
        "src/adapters/shared/html.ts":
          "export const decode=(value:string)=>value;",
        "src/problem/extract/codec.ts":
          'export {decode} from "../../adapters/shared/html";',
        "src/problem/cnoi/transform.ts":
          'export {decode} from "../extract/codec";',
        "src/problem/render/typst-renderer.ts": "export const render=()=>{};",
        "entrypoints/problem-export/main.ts":
          'import {render} from "../../src/problem/render/typst-renderer"; import {decode} from "../../src/problem/extract/codec"; render(); decode("a");',
      }),
    ).toEqual([]);
  });
});
