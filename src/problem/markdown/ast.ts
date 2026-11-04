export interface TextInline {
  type: "text";
  value: string;
}

export interface StrongInline {
  type: "strong";
  children: readonly InlineNode[];
}

export interface EmphasisInline {
  type: "emphasis";
  children: readonly InlineNode[];
}

export interface DeleteInline {
  type: "delete";
  children: readonly InlineNode[];
}

export interface LinkInline {
  type: "link";
  url: string;
  title?: string;
  children: readonly InlineNode[];
}

export interface InlineCodeInline {
  type: "inline-code";
  value: string;
}

export interface InlineMath {
  type: "inline-math";
  value: string;
  /** Display-delimited math embedded in an otherwise inline HTML context. */
  display?: boolean;
}

/** CSS box used to size a statement image without upscaling it. */
export interface ImageFrame {
  title?: string;
  width?: number;
  height?: number;
  /** CSS zoom factor. `zoom: 75%` is 0.75. */
  zoom?: number;
  /** Explicit width as a fraction of the content box. */
  widthRatio?: number;
  /** Maximum width as a fraction of the content box. `100%` is 1. */
  maxWidthRatio?: number;
  maxWidthPx?: number;
  maxHeightRatio?: number;
  maxHeightPx?: number;
}

export interface ImageInline extends ImageFrame {
  type: "image-inline";
  url: string;
  alt: string;
}

export interface BreakInline {
  type: "break";
}

export type InlineNode =
  | TextInline
  | StrongInline
  | EmphasisInline
  | DeleteInline
  | LinkInline
  | InlineCodeInline
  | InlineMath
  | ImageInline
  | BreakInline;

export interface HeadingBlock {
  type: "heading";
  level: number;
  children: readonly InlineNode[];
}

export interface ParagraphBlock {
  type: "paragraph";
  children: readonly InlineNode[];
  /** Note under a figure. One size smaller than body copy. */
  caption?: boolean;
}

export interface MathBlock {
  type: "math";
  value: string;
}

export interface CodeBlock {
  type: "code";
  value: string;
  language?: string;
  caption?: string;
  /**
   * One entry per line when the preformatted block contains math.
   * Plain value remains for code that cannot embed formulas.
   */
  lines?: readonly (readonly InlineNode[])[];
}

export interface ListItem {
  checked?: boolean;
  children: readonly MarkdownBlock[];
}

export interface ListBlock {
  type: "list";
  ordered: boolean;
  start?: number;
  items: readonly ListItem[];
}

export interface TableCellSpan {
  colspan: number;
  rowspan: number;
}

export type TableColumnAlign = "left" | "center" | "right";

export interface TableBlock {
  type: "table";
  /** Set for Luogu `::cute-table{tuack}`. Rendering uses the same book-tab grid as other tables. */
  style?: "tuack";
  headers: readonly (readonly InlineNode[])[];
  rows: readonly (readonly (readonly InlineNode[])[])[];
  /**
   * Parallel to `[headers, ...rows]` when a header exists, otherwise to `rows`.
   * `null` is covered by another cell. Absent when every cell is 1x1.
   */
  spans?: readonly (readonly (TableCellSpan | null)[])[];
  /**
   * One entry per column. Absent when the source did not set an alignment.
   * `null` means the column stays centered.
   */
  alignments?: readonly (TableColumnAlign | null)[];
}

export interface FigureBlock {
  type: "figure";
  caption?: string;
  blocks: readonly MarkdownBlock[];
}

export interface AlignBlock {
  type: "align";
  align: "center" | "right";
  blocks: readonly MarkdownBlock[];
}

export interface ImageBlock extends ImageFrame {
  type: "image";
  url: string;
  alt: string;
}

export interface QuoteBlock {
  type: "quote";
  blocks: readonly MarkdownBlock[];
}

export interface ThematicBreakBlock {
  type: "thematic-break";
}

export type MarkdownBlock =
  | HeadingBlock
  | ParagraphBlock
  | MathBlock
  | CodeBlock
  | ListBlock
  | TableBlock
  | ImageBlock
  | QuoteBlock
  | AlignBlock
  | FigureBlock
  | ThematicBreakBlock;

export interface MarkdownRoot {
  readonly type: "root";
  readonly children: readonly MarkdownBlock[];
}
