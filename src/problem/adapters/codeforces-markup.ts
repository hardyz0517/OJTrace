import {
  findAll,
  findFirst,
  hasClass,
  type HtmlElementNode,
  type HtmlRootNode,
} from "../extract/html-document";

/** Translate source HTML conventions to declared semantic markup, without changing content. */
export function recognizeCodeforcesMarkup(
  root: HtmlElementNode | HtmlRootNode,
): void {
  for (const node of findAll(root, () => true)) {
    if (hasClass(node, "test-example-line"))
      node.attrs["data-ojtrace-code-line"] = "true";
    if (hasClass(node, "section-title") && !/^h[1-6]$/.test(node.tagName))
      node.tagName = "h2";
    if (
      (hasClass(node, "input") || hasClass(node, "output")) &&
      !/^h[1-6]$/.test(node.tagName)
    ) {
      const label = findFirst(node, (child) => hasClass(child, "title"));
      // A title visually belongs to the example container. Its text is not classified here.
      if (label && !/^h[1-6]$/.test(label.tagName)) {
        let parent = node.parent;
        while (
          parent &&
          !hasClass(parent, "sample-tests") &&
          !hasClass(parent, "sample-test")
        )
          parent = parent.parent;
        label.tagName = parent ? "h3" : "h2";
      }
    }
    if (
      hasClass(node, "tex-font-style-bf") ||
      hasClass(node, "tex-font-style-textbf")
    )
      node.tagName = "strong";
    if (
      hasClass(node, "tex-font-style-it") ||
      hasClass(node, "tex-font-style-textit")
    )
      node.tagName = "em";
    if (hasClass(node, "tex-font-style-tt")) {
      let parent = node.parent;
      while (parent && parent.tagName !== "pre") parent = parent.parent;
      if (!parent) node.tagName = "code";
    }
  }
}
