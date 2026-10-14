import type { ProblemDocument } from "../domain";
import { problemDisplayName } from "../domain";
import { CODE_THEME_PATH } from "./code-theme";
import { statementBlocksToTypst } from "./statement-to-typst";
import { problemRenderStyle } from "./style-tokens";
import { escapeTypstContent, typstStringLiteral } from "./typst-escape";

function fontList(fonts: readonly string[]): string {
  return `(${fonts.map((font) => `"${font}"`).join(", ")})`;
}

function limitLine(document: ProblemDocument): string {
  const parts = [
    document.timeLimit
      ? `时间限制#h(0.45em)${escapeTypstContent(document.timeLimit.display)}`
      : "",
    document.memoryLimit
      ? `内存限制#h(0.45em)${escapeTypstContent(document.memoryLimit.display)}`
      : "",
  ].filter(Boolean);
  if (!parts.length) return "";
  return `#align(center)[#set par(first-line-indent: 0pt); ${parts.join("#h(1.6em)")}]`;
}

function headerRight(document: ProblemDocument): string {
  const id = document.problemId.trim();
  const title = document.title.trim();
  if (!id) return escapeTypstContent(title);
  if (
    !title ||
    title === id ||
    title.startsWith(`${id} `) ||
    title.startsWith(`${id}:`) ||
    title.startsWith(`${id}：`)
  ) {
    return escapeTypstContent(title || id);
  }
  return `${escapeTypstContent(id)}#h(0.5em)${escapeTypstContent(title)}`;
}

/**
 * Single-problem Typst document. Body type, section brackets, sample frames,
 * tables, and page furniture follow the published CNOI statement. The time
 * and memory line, and a header of platform plus problem id and title, are
 * the only intentional departures. This source is original.
 *
 * Body text and paragraph metrics are set before the page so the header keeps
 * the 12pt strut. The 10pt header run is an inner text element; sizing the
 * whole header to 10pt sits the words 1.4pt too close to the rule.
 */
export function problemDocumentToTypst(document: ProblemDocument): string {
  const style = problemRenderStyle;
  const lang =
    document.language === "zh"
      ? "zh"
      : document.language === "ja"
        ? "ja"
        : "en";
  const platform = escapeTypstContent(problemDisplayName(document.oj));
  const sample = style.sample;
  return `
#import "@preview/mitex:0.2.5": mi
#set document(title: ${typstStringLiteral(document.title)})
#let cjk-align-mark = box(width: 0pt, hide[兔])
#let thematic-break = line(length: 100%, stroke: rgb("${style.colors.rule}") + 0.5pt)
#let in-raw = state("in-raw", false)

#set text(
  font: ${fontList(style.fonts.body)},
  size: ${style.body.sizePt}pt,
  fill: rgb("${style.colors.ink}"),
  lang: "${lang}",
)
#set par(first-line-indent: (amount: 2em, all: true), leading: ${style.body.leadingEm}em, spacing: ${style.body.spacingEm}em)
#set page(
  paper: "a4",
  margin: (
    top: ${style.page.marginTop},
    bottom: ${style.page.marginBottom},
    left: ${style.page.marginLeft},
    right: ${style.page.marginRight},
  ),
  header: [
    #set par(first-line-indent: 0em)
    #text(size: ${style.header.sizePt}pt, font: ${fontList(style.fonts.header)})[${platform} #h(1fr) ${headerRight(document)}]
    #v(-4pt)
    #line(length: 100%, stroke: ${style.header.rulePt}pt)
  ],
  numbering: (now, total) => [
    #text(size: ${style.footer.sizePt}pt)[
      第 #(now) 页 ~~~~ 共 #link((page: total, x: 2.5cm, y: 1.5cm))[#text(fill: rgb("${style.footer.link}"))[#(total)]] 页
    ]
  ],
)

#let fix-loose-lists(doc) = {
  show list: source => {
    let nesting = state("oj-list-nesting", 0)
    for (index, item) in source.children.enumerate() {
      let marker = context {
        let depth = nesting.get()
        if type(source.marker) == array {
          source.marker.at(calc.rem-euclid(depth, source.marker.len()))
        } else if type(source.marker) == content {
          source.marker
        } else {
          source.marker(depth)
        }
      }
      let front = {
        marker
        h(source.body-indent)
      }
      context {
        set par(first-line-indent: 0pt, hanging-indent: measure(front).width)
        pad(left: source.indent, {
          front
          nesting.update(value => value + 1)
          item.body
          parbreak()
          nesting.update(value => value - 1)
        })
      }
    }
  }
  show enum: source => {
    let start = if source.start == auto {
      if source.children.first().has("number") {
        if source.reversed { source.children.first().number } else { 1 }
      } else {
        if source.reversed { source.children.len() } else { 1 }
      }
    } else {
      source.start
    }
    let number = start
    let parents = state("oj-enum-parents", ())
    for (index, item) in source.children.enumerate() {
      number = if item.has("number") and type(item.number) == int { item.number } else { number }
      if source.reversed { number = start - index }
      let label = if source.full {
        context numbering(source.numbering, ..parents.get(), number)
      } else {
        numbering(source.numbering, number)
      }
      let widest = if source.full {
        context numbering(source.numbering, ..parents.get(), source.children.len())
      } else {
        numbering(source.numbering, source.children.len())
      }
      label = context box(
        width: measure(widest).width,
        align(right, text(overhang: false, label)),
      )
      if not source.reversed { number += 1 }
      let front = {
        label
        h(source.body-indent)
      }
      let saved = number
      context {
        set par(first-line-indent: 0pt, hanging-indent: measure(front).width)
        pad(left: source.indent, {
          front
          parents.update(chain => chain + (saved,))
          item.body
          parbreak()
          parents.update(chain => chain.slice(0, -1))
        })
      }
    }
  }
  doc
}
#show: fix-loose-lists
#set enum(indent: 1.75em, numbering: n => numbering("1.", n))
#set list(indent: 1.75em, marker: ([•], [–], [∗], [·]))

#show strong: item => {
  if in-raw.get() { item } else {
    set text(font: ${fontList(style.fonts.heading)})
    show regex("\\\\p{sc=Hani}+"): han => underline(han, offset: 3pt, stroke: (
      cap: "round",
      thickness: 0.1em,
      dash: (array: (0em, 1em), phase: 0.5em),
    ))
    item
  }
}
#show heading.where(level: 1): it => {
  set par(first-line-indent: 0pt)
  set text(size: ${style.title.sizePt}pt, weight: "regular", font: ${fontList(style.fonts.title)})
  set heading(bookmarked: true)
  // h(2em) here shifts the title right by 1em. The indent is already disabled.
  pad(top: 10pt, align(center, it.body))
}
#show heading.where(level: 2): it => {
  set text(size: ${style.heading.h2SizePt}pt, weight: "regular", font: ${fontList(style.fonts.heading)})
  set heading(bookmarked: true)
  pad(left: 1.5em, top: 1em, bottom: 0.5em, [【] + it.body + [】])
}
#show emph: it => {
  if in-raw.get() { it } else {
    set text(font: ${fontList(style.fonts.emphasis)}, weight: "bold")
    it
  }
}
#show link: set text(fill: rgb("${style.colors.link}"))
#let oj-sample-frame(body) = {
  let border = ${sample.borderPt}pt + rgb("${style.colors.sampleBorder}")
  block(
    inset: (left: ${sample.frameGutterPt}pt),
    block(
      width: 100% + ${sample.frameOutsetPt}pt,
      stroke: (x: border),
      inset: (x: ${sample.insetXPt}pt, top: ${sample.insetTopPt}pt, bottom: ${sample.insetBottomPt}pt),
      place(
        dx: -${sample.insetXPt}pt,
        dy: -${sample.insetTopPt}pt,
        line(stroke: border, length: 100% + ${sample.insetXPt * 2}pt),
      )
        + {
          set par(spacing: 0pt)
          body
        }
        + place(
          dx: -${sample.insetXPt}pt,
          dy: ${sample.insetBottomPt}pt,
          line(stroke: border, length: 100% + ${sample.insetXPt * 2}pt),
        ),
    ),
  )
}
#show raw: it => {
  in-raw.update(true)
  set text(font: ${fontList(style.fonts.code)}, size: ${style.code.sizePt}pt)
  show strong: inner => text(inner.body, weight: "medium")
  if not it.block { it } else {
    show raw.line: jt => {
      block(
        place(
          dx: -${sample.numberGapPt}pt - measure([#jt.number]).width,
          text(fill: rgb("${style.colors.lineNumber}"), size: ${sample.numberSizePt}pt, [#jt.number]) + cjk-align-mark,
        )
          + par(
            leading: ${sample.lineLeadingEm}em,
            spacing: ${sample.lineSpacingEm}em,
            first-line-indent: 0em,
            hanging-indent: ${sample.hangingIndentEm}em,
            cjk-align-mark + jt,
          ),
      )
    }
    oj-sample-frame(it)
  }
  in-raw.update(false)
}
#set raw(tab-size: 4, theme: ${typstStringLiteral(CODE_THEME_PATH)})
#let oj-sample-lines(lines) = context {
  set text(font: ${fontList(style.fonts.code)}, size: ${style.code.sizePt}pt)
  oj-sample-frame({
    let last = lines.len() - 1
    for (index, line) in lines.enumerate() {
      let label = str(index + 1)
      let number-width = measure([#label]).width
      // Same grid as a plain sample: glyph box plus paragraph leading.
      // A fixed row height clips a tall formula, and the last line must
      // not keep trailing leading inside the frame.
      block(
        above: 0pt,
        below: if index == last { 0pt } else { par.leading },
        place(
          dx: -${sample.numberGapPt}pt - number-width,
          text(fill: rgb("${style.colors.lineNumber}"), size: ${sample.numberSizePt}pt)[#label] + cjk-align-mark,
        ) + par(
          leading: ${sample.lineLeadingEm}em,
          spacing: ${sample.lineSpacingEm}em,
          first-line-indent: 0em,
          hanging-indent: ${sample.hangingIndentEm}em,
          cjk-align-mark + line,
        ),
      )
    }
  })
}

#show figure: it => pad(top: 9pt, bottom: 6pt, it)
#set figure(numbering: none)
#show math.equation: set text(font: "${style.math.fontFamily}")
#set table(
  stroke: (x, y) => (
    left: if x > 0 { ${style.tuack.thinPt}pt },
    bottom: ${style.tuack.bottomRulePt}pt,
    top: if y == 0 { ${style.tuack.topRulePt}pt } else if y == 1 { ${style.tuack.headerRulePt}pt } else { ${style.tuack.thinPt}pt },
  ),
  align: center + horizon,
)

#heading(level: 1)[${escapeTypstContent(document.title)}]

${limitLine(document)}

${statementBlocksToTypst(document.blocks, document.assets)}
`;
}
