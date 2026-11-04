export type LineKind = "same" | "added" | "removed" | "moved";
/** Bounded line LCS. Large documents use a linear prefix/suffix comparison. */
export function markdownDiff(
  source: string,
  target: string,
): { source: LineKind[]; target: LineKind[] } {
  const a = source.split("\n"),
    b = target.split("\n");
  const left: LineKind[] = a.map(() => "removed"),
    right: LineKind[] = b.map(() => "added");
  if (a.length * b.length <= 600_000) {
    const stride = b.length + 1,
      table = new Uint32Array((a.length + 1) * stride);
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        table[i * stride + j] =
          a[i] === b[j]
            ? table[(i + 1) * stride + j + 1]! + 1
            : Math.max(
                table[(i + 1) * stride + j]!,
                table[i * stride + j + 1]!,
              );
    let i = 0,
      j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        left[i++] = "same";
        right[j++] = "same";
      } else if (table[(i + 1) * stride + j]! >= table[i * stride + j + 1]!)
        i++;
      else j++;
    }
  } else {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) {
      left[i] = "same";
      right[i++] = "same";
    }
    let ai = a.length - 1,
      bi = b.length - 1;
    while (ai >= i && bi >= i && a[ai] === b[bi]) {
      left[ai--] = "same";
      right[bi--] = "same";
    }
  }
  const removed = new Set(
    a.filter((line, i) => left[i] === "removed" && line.trim()),
  );
  const added = new Set(
    b.filter((line, i) => right[i] === "added" && line.trim()),
  );
  a.forEach((line, i) => {
    if (left[i] === "removed" && added.has(line)) left[i] = "moved";
  });
  b.forEach((line, i) => {
    if (right[i] === "added" && removed.has(line)) right[i] = "moved";
  });
  return { source: left, target: right };
}
