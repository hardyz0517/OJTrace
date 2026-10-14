/**
 * Typst layout numbers and font family names. Packaged font files live in
 * font-manifest.ts. This module is not a second print stylesheet.
 */
export const problemRenderStyle = {
  page: {
    marginTop: "2.5cm",
    marginBottom: "2.5cm",
    marginLeft: "2.5cm",
    marginRight: "2.5cm",
  },
  fonts: {
    body: [
      "Latin Modern Roman 12",
      "SimSun",
      "Noto Serif CJK SC",
      "OJTrace Mincho",
    ],
    title: [
      "Latin Modern Roman 17",
      "SimHei",
      "Noto Serif CJK SC",
      "OJTrace Hei",
    ],
    heading: [
      "Latin Modern Roman 12",
      "SimHei",
      "Noto Serif CJK SC",
      "OJTrace Hei",
    ],
    /** 10pt running header. Body copy uses the 12pt optical size. */
    header: [
      "Latin Modern Roman",
      "SimSun",
      "Noto Serif CJK SC",
      "OJTrace Mincho",
    ],
    /**
     * Unsized family on purpose. Emphasis stays italic, and that face is the
     * 10pt bold italic cut rather than the 12pt roman used for body text.
     */
    emphasis: [
      "Latin Modern Roman",
      "SimSun",
      "Noto Serif CJK SC",
      "OJTrace Mincho",
    ],
    code: ["Fira Mono", "SimSun", "Noto Serif CJK SC", "OJTrace Mincho"],
  },
  title: {
    sizePt: 18,
  },
  caption: {
    /** One size below body text, matching a figure note. */
    sizePt: 10.5,
  },
  body: {
    sizePt: 12,
    /** Typst paragraph leading is extra space between baselines, not a ratio. */
    leadingEm: 0.7,
    spacingEm: 0.7,
  },
  heading: {
    h2SizePt: 13,
  },
  code: {
    sizePt: 12,
  },
  sample: {
    borderPt: 0.4,
    /** Extra space between baselines when a sample line wraps. */
    lineLeadingEm: 0.65,
    lineSpacingEm: 0,
    numberSizePt: 10,
    numberGapPt: 9,
    frameGutterPt: 9,
    frameOutsetPt: 3,
    insetXPt: 3,
    insetTopPt: 6,
    insetBottomPt: 9,
    hangingIndentEm: 1.5,
  },
  tuack: {
    /** Internal rules. Outer vertical borders are omitted. */
    thinPt: 0.4,
    /** Rule above the header, same weight as the bottom rule. */
    topRulePt: 2,
    /** Rule directly under the header. */
    headerRulePt: 1.2,
    bottomRulePt: 2,
  },
  math: {
    fontFamily: "New Computer Modern Math",
  },
  header: {
    sizePt: 10,
    rulePt: 0.3,
  },
  footer: {
    sizePt: 10,
    link: "#0000ff",
  },
  colors: {
    ink: "#000000",
    rule: "#808080",
    link: "#ed028c",
    sampleBorder: "#0000ff",
    lineNumber: "#808080",
  },
} as const;
