import type { ProblemMetadata, ProblemWarning } from "../domain";
import type {
  HeadingBlock,
  MarkdownBlock,
  MarkdownRoot,
} from "../markdown/ast";
import { inlineText } from "../markdown/text";
import { sectionTitle } from "./rules/common";
import type { CnoiRuleOverrides, SectionRole } from "../../domain/cnoi-rules";
import {
  resolveRules,
  matchesTitle,
  matchedHeadingNumber,
  matchContext,
} from "./rules/config";
import { prepareCodeforcesAst } from "./rules/codeforces";
export { ojRules } from "./rules/config";
interface Section {
  heading?: HeadingBlock;
  content: MarkdownBlock[];
  children: Section[];
  role?: SectionRole;
  sampleGroup?: boolean;
  number?: string;
  path?: string;
  ambiguous?: boolean;
}
const heading = (value: string, level: number): HeadingBlock => ({
  type: "heading",
  level,
  children: [{ type: "text", value }],
});

function sections(nodes: readonly MarkdownBlock[]): Section {
  const root: Section = { content: [], children: [] };
  const stack = [root];
  for (const node of nodes) {
    if (node.type !== "heading") {
      stack.at(-1)!.content.push(node);
      continue;
    }
    while (stack.length > 1 && stack.at(-1)!.heading!.level >= node.level)
      stack.pop();
    const section: Section = { heading: node, content: [], children: [] };
    stack.at(-1)!.children.push(section);
    stack.push(section);
  }
  return root;
}

/** AST in, AST out. Statement semantics are derived exclusively after Source parsing. */
export function transformToCnoi(
  ast: MarkdownRoot,
  metadata: ProblemMetadata,
  overrides: CnoiRuleOverrides = {},
): { ast: MarkdownRoot; warnings: readonly ProblemWarning[] } {
  const rules = resolveRules(metadata.oj, overrides);
  const warnings: ProblemWarning[] = [];
  const warn = (code: string, node: Section, message: string) =>
    warnings.push({
      code,
      message: `${node.path ?? ""}「${node.heading ? inlineText(node.heading.children) : ""}」：${message}`,
    });
  const classify = (node: Section, ancestors: (SectionRole | undefined)[]) => {
    const title = inlineText(node.heading!.children);
    const matches = rules.mappings.filter(
      (rule) =>
        rule.enabled &&
        matchContext(rule.contexts, ancestors) &&
        matchesTitle(rule, title),
    );
    const priority = Math.max(...matches.map((rule) => rule.priority));
    const chosen = matches.filter((rule) => rule.priority === priority);
    if (new Set(chosen.map((rule) => rule.role)).size > 1) {
      node.ambiguous = true;
      warn(
        "cnoi-ambiguous",
        node,
        `匹配冲突（${chosen.map((r) => r.id).join("、")}），已保留原结构。`,
      );
      return;
    }
    const winner = chosen[0];
    node.role = winner?.role;
    if (winner?.matcher)
      node.number = matchedHeadingNumber(winner.matcher, title) || undefined;
    node.sampleGroup = Boolean(winner?.group && winner.role === "samples");
  };
  const safeHeading = (nodes: HeadingBlock["children"]): boolean =>
    nodes.every(
      (node) =>
        node.type === "text" ||
        ((node.type === "strong" || node.type === "emphasis") &&
          safeHeading(node.children)),
    );
  let prepared = ast;
  if (metadata.oj === "codeforces") prepared = prepareCodeforcesAst(prepared);
  const tree = sections(prepared.children);
  const first = tree.children[0];
  if (
    rules.removeDocumentTitle &&
    !tree.content.length &&
    first?.heading?.level === 1 &&
    safeHeading(first.heading.children) &&
    [metadata.title, `${metadata.problemId} ${metadata.title}`].includes(
      inlineText(first.heading.children),
    )
  ) {
    tree.content.push(...first.content);
    tree.children.splice(0, 1, ...first.children);
  }
  const numberOf = (title: string): string | undefined => {
    const token = "([0-9A-Za-z一二三四五六七八九十]+)";
    const sample = new RegExp(
      `^(?:(?:sample|example)\\s*(?:input|output)|入力例|出力例|输入样例|输出样例)(?:\\s*#?\\s*${token})?$`,
      "iu",
    ).exec(title);
    if (sample) return sample[1];
    const known = new RegExp(
      `^(?:(?:sample|example)\\s*(?:input|output)|input|output|输入样例|输出样例|入力例|出力例|输入|输出|入力|出力|examples?|samples?|样例|示例|输入输出样例)\\s*#?\\s*${token}$`,
      "iu",
    ).exec(title)?.[1];
    const middle =
      /(?:样例|示例)\s*#?\s*([0-9A-Za-z一二三四五六七八九十]+)\s*(?:输入|输出)/u.exec(
        title,
      )?.[1];
    const generic =
      /(?:\s|#)([0-9]+|[A-Za-z]|[IVXLCDM]+|[一二三四五六七八九十]+)\s*$/u.exec(
        title,
      )?.[1];
    return middle ?? known ?? generic;
  };
  const analyze = (
    node: Section,
    ancestors: (SectionRole | undefined)[] = [],
    path = "",
  ) => {
    node.path = path;
    classify(node, ancestors);
    const title = inlineText(node.heading!.children);
    node.number ??= numberOf(title);
    if (
      !node.role &&
      !node.ambiguous &&
      (ancestors.length === 0 || ancestors.at(-1) === "samples")
    )
      warn(
        "cnoi-unrecognized",
        node,
        "未识别章节，正文已保留，并作为排序锚点。",
      );
    if (node.ambiguous) return;
    node.children.forEach((child, i) =>
      analyze(child, [...ancestors, node.role], `${path}.${i + 1}`),
    );
    if (
      rules.numbering === "inherit-group" &&
      node.role === "samples" &&
      node.number
    ) {
      const inputs = node.children.filter((c) => c.role === "sample-input");
      const outputs = node.children.filter((c) => c.role === "sample-output");
      if (inputs.length === 1 && outputs.length === 1)
        for (const child of [...inputs, ...outputs]) {
          if (!child.number) child.number = node.number;
          else if (child.number !== node.number)
            warn(
              "cnoi-number-conflict",
              child,
              "样例编号与父组冲突，已保留原编号。",
            );
        }
      else if (inputs.length || outputs.length)
        warn(
          "cnoi-number-ambiguous",
          node,
          "父组内没有唯一的输入输出结构，未继承组编号。",
        );
    }
  };
  tree.children.forEach((child, i) => analyze(child, [], String(i + 1)));
  const rootLevels = tree.children.map((child) => child.heading!.level);
  const maxLevel = (node: Section): number =>
    Math.max(node.heading?.level ?? 0, ...node.children.map(maxLevel));
  const requiredShift = rules.sectionLevel - Math.min(...rootLevels);
  if (
    rootLevels.length &&
    requiredShift > 0 &&
    maxLevel(tree) + requiredShift > 6 &&
    tree.children.some((child) => child.role)
  ) {
    warnings.push({
      code: "cnoi-heading-depth",
      message:
        "当前主章节层级无法保留所有嵌套标题关系，已保留原题面结构；请降低主章节层级。",
    });
    return { ast: prepared, warnings };
  }
  const rank = (section: Section) => {
    if (section.sampleGroup) return rules.order.indexOf("samples");
    if (!section.role || section.role === "explanation") return -1;
    return rules.order.indexOf(
      (section.role.startsWith("sample-")
        ? "samples"
        : section.role) as (typeof rules.order)[number],
    );
  };
  const ordered = (nodes: readonly Section[]) => {
    if (!rules.reorder) return nodes;
    const result: Section[] = [];
    let run: Section[] = [];
    const seen = new Set<SectionRole>();
    const flush = () => {
      result.push(...run.sort((a, b) => rank(a) - rank(b)));
      run = [];
    };
    for (const node of nodes) {
      const repeated =
        node.role && !node.role.startsWith("sample") && seen.has(node.role);
      if (rank(node) < 0 || repeated) {
        flush();
        result.push(node);
        seen.clear();
      } else {
        run.push(node);
        if (node.role) seen.add(node.role);
      }
    }
    flush();
    return result;
  };
  const render = (
    section: Section,
    delta = 0,
    parentRole?: SectionRole,
    numberedContext = false,
    parentWrapperKept = false,
  ): MarkdownBlock[] => {
    if (section.ambiguous) {
      const originalTree = (node: Section): MarkdownBlock[] => [
        ...(node.heading ? [node.heading] : []),
        ...node.content,
        ...node.children.flatMap(originalTree),
      ];
      return originalTree(section);
    }
    const original = section.heading;
    let wrapper =
      section.role === "samples" && !section.sampleGroup && rules.unwrapSamples;
    if (wrapper && original && !safeHeading(original.children)) {
      wrapper = false;
      warn(
        "cnoi-rich-title",
        section,
        "包装标题包含链接、公式或其他内容，已保留原文。",
      );
    }
    let title = original;
    let shift =
      wrapper && original ? rules.sectionLevel - original.level - 1 : delta;
    if (original && !wrapper) {
      const canonical =
        (section.role !== undefined || section.sampleGroup) &&
        (!parentRole ||
          parentRole === "description" ||
          (parentRole === "samples" && !parentWrapperKept)) &&
        !numberedContext;
      const level = canonical
        ? rules.sectionLevel
        : Math.max(1, Math.min(6, original.level + delta));
      if (original.level + delta > 6 || original.level + delta < 1)
        warn(
          "cnoi-heading-depth",
          section,
          "标题层级超出 Markdown 范围，已限制在 1–6 级。要求更深层次时请降低主章节层级。",
        );
      title = { ...original, level };
      shift = level - original.level;
      if (
        rules.sampleTitleMode === "contextual" &&
        parentRole === "samples" &&
        (section.role === "sample-input" || section.role === "sample-output")
      ) {
        const value = inlineText(original.children);
        const prefix = /^(input|output)(?=\s|#|\d|$)/iu.test(value)
          ? "Sample "
          : /^(输入|输出)(?=\s|#|[0-9一二三四五六七八九十]|$)/u.test(value)
            ? "样例"
            : undefined;
        if (prefix)
          title = {
            ...title,
            children: [{ type: "text", value: prefix }, ...original.children],
          };
        else if (/^(?:入力|出力)(?=\s|#|\d|$)/u.test(value)) {
          const japanese = (
            nodes: HeadingBlock["children"],
          ): HeadingBlock["children"] =>
            nodes.map((node) =>
              node.type === "text"
                ? {
                    ...node,
                    value: node.value.replace(
                      /^(入力|出力)(?=\s|#|\d|$)/u,
                      "$1例",
                    ),
                  }
                : "children" in node
                  ? { ...node, children: japanese(node.children) }
                  : node,
            );
          title = { ...title, children: japanese(original.children) };
        }
      }
    }
    if (title && section.role) {
      const language = metadata.language;
      const supported =
        language === "zh" || language === "en" || language === "ja";
      const sample =
        section.role === "sample-input" || section.role === "sample-output";
      const suffix = section.number ? ` #${section.number}` : "";
      let replacement: string | undefined;
      if (supported && sample && rules.sampleTitleMode === "template") {
        const templates = rules.sampleTemplates[language];
        const template =
          section.role === "sample-input"
            ? templates?.input
            : templates?.output;
        if (template)
          replacement = template
            .replaceAll("{numberSuffix}", suffix)
            .replaceAll("{number}", section.number ?? "");
      }
      if (
        supported &&
        rules.headingMode === "canonical" &&
        (!sample || rules.sampleTitleMode !== "original")
      ) {
        replacement ??=
          (rules.labels[language]?.[section.role] ??
            sectionTitle(language, section.role)) +
          (sample || section.role === "samples" ? suffix : "");
      }
      if (replacement !== undefined) {
        if (safeHeading(original!.children))
          title = {
            ...title,
            children: [{ type: "text", value: replacement }],
          };
        else
          warn(
            "cnoi-rich-title",
            section,
            "标题包含链接、公式或其他内容，已保留原文。",
          );
      } else if (
        sample &&
        rules.numbering === "inherit-group" &&
        section.number &&
        !numberOf(inlineText(original!.children))
      ) {
        title = {
          ...title,
          children: [...title.children, { type: "text", value: suffix }],
        };
      }
    }
    const result: MarkdownBlock[] = [
      ...(title && !wrapper ? [title] : []),
      ...section.content,
    ];
    const context = section.sampleGroup
      ? "samples"
      : (section.role ?? (section.heading ? "explanation" : undefined));
    for (const child of section.children)
      result.push(
        ...render(
          child,
          shift,
          context,
          numberedContext || section.sampleGroup,
          section.role === "samples" && !wrapper,
        ),
      );
    return result;
  };
  const output: MarkdownBlock[] = [...tree.content];
  if (
    rules.addDescriptionHeading &&
    tree.content.length &&
    !tree.children.some((child) => child.role === "description")
  ) {
    const language = metadata.language;
    const title =
      rules.headingMode === "canonical" && language && language !== "other"
        ? (rules.labels[language]?.description ??
          sectionTitle(language, "description"))
        : sectionTitle(language, "description");
    if (title) output.unshift(heading(title, rules.sectionLevel));
  }
  // Shift unknown sibling headings together with known ones, preserving their relationship.
  const rootDelta = tree.children.some(
    (child) => child.role || child.sampleGroup,
  )
    ? rules.sectionLevel -
      Math.min(
        ...tree.children.map(
          (child) => child.heading?.level ?? rules.sectionLevel,
        ),
      )
    : 0;
  for (const child of ordered(tree.children))
    output.push(...render(child, rootDelta));
  // Content blocks are opaque to structure operations, including identical samples.
  const contentOf = (nodes: readonly MarkdownBlock[]) =>
    nodes.filter((node) => node.type !== "heading");
  const before = contentOf(prepared.children);
  const after = contentOf(output);
  const counts = new Map<MarkdownBlock, number>();
  before.forEach((node) => counts.set(node, (counts.get(node) ?? 0) + 1));
  after.forEach((node) => counts.set(node, (counts.get(node) ?? 0) - 1));
  if (
    before.length !== after.length ||
    [...counts.values()].some((count) => count !== 0)
  )
    throw new Error("转换未能完整保留正文，已停止转换。");
  return { ast: { type: "root", children: output }, warnings };
}
