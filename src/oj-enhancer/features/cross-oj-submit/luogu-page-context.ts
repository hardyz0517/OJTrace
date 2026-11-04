export interface LuoguPageProblemContext {
  problemId: string;
  type?: string;
  atcoderOriginUrl?: string;
}

/** Read only the public problem identity metadata embedded by Luogu. */
export function readLuoguPageProblemContextInPage():
  LuoguPageProblemContext | undefined {
  const context = document.querySelector<HTMLScriptElement>(
    'script#lentille-context[type="application/json"]',
  );
  if (!context?.textContent) return undefined;
  try {
    const parsed: unknown = JSON.parse(context.textContent);
    if (!parsed || typeof parsed !== "object") return undefined;
    const data = (parsed as { data?: unknown }).data;
    if (!data || typeof data !== "object") return undefined;
    const problem = (data as { problem?: unknown }).problem;
    if (!problem || typeof problem !== "object") return undefined;
    const record = problem as {
      pid?: unknown;
      type?: unknown;
      vjudge?: unknown;
    };
    if (typeof record.pid !== "string" || !record.pid.trim()) return undefined;
    const result: LuoguPageProblemContext = { problemId: record.pid.trim() };
    if (typeof record.type === "string") result.type = record.type;
    if (record.vjudge && typeof record.vjudge === "object") {
      const link = (record.vjudge as { link?: unknown }).link;
      if (typeof link === "string") result.atcoderOriginUrl = link;
    }
    return result;
  } catch {
    return undefined;
  }
}
