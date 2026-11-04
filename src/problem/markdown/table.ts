import { TABLE_CELL_LIMIT, TABLE_SPAN_LIMIT } from "../budget";
import type { TableBlock, TableCellSpan } from "./ast";

export function isTableStyleDirective(source: string): boolean {
  return /^::cute-table(?:\[\])?\{tuack\}$/.test(source.trim());
}

/** Table syntax: an unescaped ^ continues upward; < continues to the left. */
export function mergeMarkdownTable(
  table: TableBlock,
  source: readonly (readonly string[])[],
): TableBlock {
  const rows = [table.headers, ...table.rows];
  const columns = table.headers.length;
  const count = rows.length * columns;
  if (count > TABLE_CELL_LIMIT)
    throw new RangeError("Table cell budget exceeded");
  if (!columns) return table;
  const parents = Array.from({ length: count }, (_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parents[current] !== current) current = parents[current]!;
    while (index !== current) {
      const next = parents[index]!;
      parents[index] = current;
      index = next;
    }
    return current;
  };
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < columns; column++) {
      const marker = source[row]?.[column]?.trim();
      const index = row * columns + column;
      if (marker === "^" && row > 0) parents[index] = find(index - columns);
      else if (marker === "<" && column > 0) parents[index] = find(index - 1);
    }
  }
  const groups = new Map<number, number[]>();
  for (let index = 0; index < count; index++) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(index);
    groups.set(root, group);
  }
  const cells = rows.map((row) => [...row]);
  const spans: (TableCellSpan | null)[][] = rows.map((row) =>
    row.map(() => ({ colspan: 1, rowspan: 1 })),
  );
  let merged = false;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const top = Math.min(...group.map((index) => Math.floor(index / columns)));
    const bottom = Math.max(
      ...group.map((index) => Math.floor(index / columns)),
    );
    const left = Math.min(...group.map((index) => index % columns));
    const right = Math.max(...group.map((index) => index % columns));
    const rowspan = bottom - top + 1;
    const colspan = right - left + 1;
    // A nonrectangular marker group cannot describe a merged cell. Keep all
    // of its text rather than covering another cell's author content.
    if (rowspan * colspan !== group.length) continue;
    if (rowspan > TABLE_SPAN_LIMIT || colspan > TABLE_SPAN_LIMIT)
      throw new RangeError("Table span budget exceeded");
    merged = true;
    for (const index of group) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      if (row === top && column === left)
        spans[row]![column] = { rowspan, colspan };
      else {
        spans[row]![column] = null;
        cells[row]![column] = [];
      }
    }
  }
  return merged
    ? { ...table, headers: cells[0]!, rows: cells.slice(1), spans }
    : table;
}

/** Return a lossless Markdown representation, or leave an irregular HTML grid intact. */
export function markdownSpanMarkers(table: TableBlock): string[][] | undefined {
  const rows = [table.headers, ...table.rows];
  const columns = table.headers.length;
  if (!columns || rows.some((row) => row.length !== columns)) return undefined;
  const markers = rows.map((row) => row.map(() => ""));
  if (!table.spans) return markers;
  if (
    table.spans.length !== rows.length ||
    table.spans.some((row) => row.length !== columns)
  )
    return undefined;
  const occupied = new Set<number>();
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      if (occupied.has(index)) continue;
      const span = table.spans[row]?.[column];
      if (
        !span ||
        !Number.isInteger(span.rowspan) ||
        !Number.isInteger(span.colspan) ||
        span.rowspan < 1 ||
        span.colspan < 1 ||
        row + span.rowspan > rows.length ||
        column + span.colspan > columns
      )
        return undefined;
      for (let r = row; r < row + span.rowspan; r++) {
        for (let c = column; c < column + span.colspan; c++) {
          const at = r * columns + c;
          if (occupied.has(at)) return undefined;
          occupied.add(at);
          if (r === row && c === column) continue;
          if (table.spans[r]?.[c] !== null || rows[r]?.[c]?.length)
            return undefined;
          markers[r]![c] = r === row ? "<" : "^";
        }
      }
    }
  }
  return markers;
}
