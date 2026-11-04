// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readLuoguEditorInPage } from "../../src/oj-enhancer/features/cross-oj-submit/luogu-editor";

const code = `#include <bits/stdc++.h>
using namespace std;

int main()
{
    long long n,m,a;
    cin>>n>>m>>a;
    cout<<((n+a-1)/a)*((m+a-1)/a);
    return 0;
}`;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function makeElementsVisible(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 600,
    height: 240,
    top: 0,
    right: 600,
    bottom: 240,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function mountProductionVueEditor(source: string): void {
  document.body.innerHTML = `
    <div id="app">
      <div class="lang-select">C++17</div>
      <div id="editor-container"><div class="cm-editor"><div class="cm-content"></div></div></div>
    </div>`;
  const root = document.querySelector<HTMLElement>("#app")!;
  const container = document.querySelector<HTMLElement>("#editor-container")!;
  const codeEditor = {
    type: { __name: "CodeEditor" },
    props: { modelValue: source },
    subTree: { el: container },
  };
  const vnode = {
    component: {
      type: { __name: "LuoguApp" },
      subTree: { children: [{ component: codeEditor }] },
    },
  };

  // Production Vue stores the render tree on the mount container. It does not
  // expose __vueParentComponent or app._instance without devtools enabled.
  Object.defineProperty(root, "_vnode", { value: vnode });
  Object.defineProperty(root, "__vue_app__", {
    value: { _container: root },
  });
}

describe("Luogu editor reader", () => {
  it("reads the full CodeEditor model from the production Vue render tree", () => {
    makeElementsVisible();
    mountProductionVueEditor(code);

    expect(readLuoguEditorInPage()).toEqual({
      ok: true,
      code,
      language: "C++17",
      editorKind: "luogu-vue-codemirror-model",
    });
  });

  it("fails closed when multiple active CodeMirror editors are ambiguous", () => {
    makeElementsVisible();
    mountProductionVueEditor(code);
    document
      .querySelector("#editor-container")!
      .insertAdjacentHTML("beforeend", '<div class="cm-editor"></div>');

    expect(readLuoguEditorInPage()).toEqual({
      ok: false,
      reason: "editor-unavailable",
    });
  });

  it("reports an empty model instead of reading rendered line fragments", () => {
    makeElementsVisible();
    mountProductionVueEditor("");

    expect(readLuoguEditorInPage()).toEqual({
      ok: false,
      reason: "empty-code",
    });
  });

  it("does not guess from visible editor text when the Vue model is unavailable", () => {
    makeElementsVisible();
    document.body.innerHTML = `
      <div class="lang-select">C++17</div>
      <div class="cm-editor"><div class="cm-content">visible text</div></div>`;

    expect(readLuoguEditorInPage()).toEqual({
      ok: false,
      reason: "editor-unavailable",
    });
  });
});
