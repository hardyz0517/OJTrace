export interface CapturedLuoguEditor {
  ok: boolean;
  code?: string;
  language?: string;
  editorKind?: string;
  reason?: "editor-unavailable" | "language-unavailable" | "empty-code";
}

/** Read the active Luogu CodeEditor model from its production Vue VNode. */
export function readLuoguEditorInPage(): CapturedLuoguEditor {
  type VueComponentInstance = {
    type?: { __name?: string };
    props?: Record<string, unknown>;
    subTree?: VueVNode;
  };
  type VueVNode = {
    component?: VueComponentInstance;
    el?: Node | null;
    children?: unknown;
    suspense?: { activeBranch?: VueVNode | null };
  };
  type VueAppContainer = HTMLElement & {
    _vnode?: VueVNode;
    __vue_app__?: { _container?: VueAppContainer };
  };

  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };
  const editors = Array.from(
    document.querySelectorAll<HTMLElement>(".cm-editor"),
  ).filter(visible);
  if (editors.length !== 1) return { ok: false, reason: "editor-unavailable" };

  const languages = Array.from(
    document.querySelectorAll<HTMLElement>(".lang-select"),
  )
    .filter(visible)
    .map((element) =>
      (element.innerText || element.textContent || "")
        .trim()
        .replace(/\s+/g, " "),
    )
    .filter(Boolean);
  if (languages.length !== 1)
    return { ok: false, reason: "language-unavailable" };

  const root = document.querySelector<VueAppContainer>("#app");
  const appContainer = root?.__vue_app__?._container ?? root;
  const rootVNode = appContainer?._vnode;
  if (!rootVNode) return { ok: false, reason: "editor-unavailable" };

  const editorInstances = new Set<VueComponentInstance>();
  const visited = new Set<VueVNode>();
  const containsEditorElement = (
    vnode: VueVNode | undefined,
    target: Element,
    seen = new Set<VueVNode>(),
  ): boolean => {
    if (!vnode || seen.has(vnode)) return false;
    seen.add(vnode);
    if (
      vnode.el instanceof Element &&
      (vnode.el === target || vnode.el.contains(target))
    )
      return true;
    if (
      vnode.component &&
      containsEditorElement(vnode.component.subTree, target, seen)
    )
      return true;
    if (
      vnode.suspense?.activeBranch &&
      containsEditorElement(vnode.suspense.activeBranch, target, seen)
    )
      return true;
    if (Array.isArray(vnode.children))
      return vnode.children.some((child) =>
        containsEditorElement(child as VueVNode, target, seen),
      );
    return false;
  };
  const visit = (vnode: VueVNode | undefined): void => {
    if (!vnode || visited.has(vnode)) return;
    visited.add(vnode);
    const instance = vnode.component;
    if (instance) {
      if (
        instance.type?.__name === "CodeEditor" &&
        containsEditorElement(instance.subTree, editors[0]!)
      )
        editorInstances.add(instance);
      visit(instance.subTree);
    }
    if (vnode.suspense?.activeBranch) visit(vnode.suspense.activeBranch);
    if (Array.isArray(vnode.children))
      vnode.children.forEach((child) => visit(child as VueVNode));
  };
  visit(rootVNode);

  if (editorInstances.size !== 1)
    return { ok: false, reason: "editor-unavailable" };
  const code = [...editorInstances][0]?.props?.modelValue;
  if (typeof code !== "string")
    return { ok: false, reason: "editor-unavailable" };
  if (!code.trim()) return { ok: false, reason: "empty-code" };

  return {
    ok: true,
    code,
    language: languages[0],
    editorKind: "luogu-vue-codemirror-model",
  };
}
