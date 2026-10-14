/** Failure while loading a bundled font/package, or while Typst compiles. */
export class ProblemCompileError extends Error {
  readonly kind: "asset" | "source";

  constructor(
    kind: "asset" | "source",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProblemCompileError";
    this.kind = kind;
  }
}

/** User-facing compile failure. Paths and stacks stay in the cause and console. */
export function compileDiagnostic(error: unknown): string {
  if (error instanceof ProblemCompileError) return error.message;
  const raw = error instanceof Error ? error.message : "";
  const first = raw.split(/\r?\n/, 1)[0] ?? "";
  const cleaned = first
    .replace(/[A-Za-z]:\\[^\s"]+/g, "")
    .replace(/(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  if (!cleaned)
    return "PDF 生成失败，本次没有生成文件。请回到题目页重新发起导出。";
  return `PDF 生成失败，本次没有生成文件。${cleaned}`;
}
