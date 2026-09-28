export interface LuoguRawRecord {
  id: number | string;
  submitTime?: number | string;
  status?: number | string;
  language?: string;
  lang?: string;
  problem?: { pid?: string; title?: string; name?: string };
  pid?: string;
  problemId?: string;
  title?: string;
}

function recordArray(value: unknown): LuoguRawRecord[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (Array.isArray(item.records)) return item.records as LuoguRawRecord[];
  if (item.records) return recordArray(item.records);
  if (Array.isArray(item.result)) return item.result as LuoguRawRecord[];
  if (item.currentData) return recordArray(item.currentData);
  if (item.data) return recordArray(item.data);
  return undefined;
}

export function parseLuoguResponse(
  text: string,
  contentType = "",
): LuoguRawRecord[] {
  const trimmed = text.trim();
  if (
    /^<(?:!doctype|html|head|body)\b/i.test(trimmed) ||
    /登录|login/i.test(trimmed.slice(0, 5_000))
  ) {
    throw new Error("Luogu response is a login page");
  }
  try {
    const records = recordArray(JSON.parse(trimmed));
    if (records) return records;
  } catch {
    // The normal page may embed encoded JSON instead of returning JSON.
  }

  const match = trimmed.match(/decodeURIComponent\(\\?"([^"\n]+)\\?"\)/);
  if (match?.[1]) {
    try {
      const decoded = decodeURIComponent(match[1]);
      const records = recordArray(JSON.parse(decoded));
      if (records) return records;
    } catch {
      // Fall through to a structured parse error.
    }
  }
  throw new Error(`Unsupported Luogu response (${contentType || "unknown"})`);
}
