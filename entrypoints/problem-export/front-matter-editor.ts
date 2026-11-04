import { Decoration, EditorView } from "@codemirror/view";
import {
  foldService,
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter, yamlLanguage } from "@codemirror/lang-yaml";
import { tags } from "@lezer/highlight";
import {
  FRONT_MATTER_LIMIT,
  frontMatterRange,
} from "../../src/problem/markdown-front-matter";

const mutedYaml = HighlightStyle.define(
  [
    { tag: tags.propertyName, color: "#667085" },
    { tag: [tags.string, tags.number, tags.bool, tags.null], color: "#737d8c" },
    { tag: [tags.comment, tags.meta], color: "#98a2b3" },
  ],
  { scope: yamlLanguage },
);

export const frontMatterEditing = [
  yamlFrontmatter({
    content: markdown({
      base: markdownLanguage,
      completeHTMLTags: false,
      pasteURLAsLink: false,
    }),
  }),
  syntaxHighlighting(mutedYaml),
  EditorView.decorations.compute(["doc"], (state) => {
    const range = frontMatterRange(
      state.doc.sliceString(0, FRONT_MATTER_LIMIT + 1),
    );
    if (!range) return Decoration.none;
    const lines = [];
    for (let from = 0; from <= range.to && from <= state.doc.length;) {
      const line = state.doc.lineAt(from);
      lines.push(
        Decoration.line({ class: "cm-frontmatter-line" }).range(line.from),
      );
      from = line.to + 1;
    }
    return Decoration.set(lines);
  }),
  foldService.of((state, start, end) => {
    if (start !== 0) return null;
    const range = frontMatterRange(
      state.doc.sliceString(0, FRONT_MATTER_LIMIT + 1),
    );
    return range?.closed ? { from: end, to: range.to } : null;
  }),
];
