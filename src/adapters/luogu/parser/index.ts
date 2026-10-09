import { LUOGU_ORIGIN } from "../urls";
export interface LuoguRawRecord {
  id: number | string;
  submitTime?: number | string;
  status?: number | string | { status?: number | string; name?: string };
  language?: number | string;
  lang?: number | string;
  time?: number | string | { value?: number | string; cost?: number | string };
  timeUsed?: number | string;
  timeCost?: number | string;
  memory?:
    number | string | { value?: number | string; cost?: number | string };
  memoryUsed?: number | string;
  memoryCost?: number | string;
  codeLength?: number;
  codeSize?: number;
  sourceLength?: number;
  code?: string;
  sourceCode?: string;
  problem?:
    | {
        pid?: string;
        title?: string;
        name?: string;
        problemId?: string;
        problemName?: string;
        content?: {
          name?: string;
          title?: string;
        };
      }
    | string;
  pid?: string;
  problemId?: string;
  title?: string;
  score?: number | string;
  points?: number | string;
  problemName?: string;
  content?: {
    name?: string;
    title?: string;
  };
  problemUrl?: string;
  // Fields used by the record detail page / embedded submission payload.
  detail?: Record<string, unknown>;
  submission?: Record<string, unknown>;
}

export interface LuoguRawUser {
  uid?: number | string;
  name?: string;
  username?: string;
}

export interface LuoguParsedResponse {
  records: LuoguRawRecord[];
  user?: LuoguRawUser;
  currentUser?: LuoguRawUser;
  count?: number;
  perPage?: number;
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

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function htmlRecords(text: string): LuoguRawRecord[] | undefined {
  if (!/<(?:html|body|a)\b/i.test(text)) return undefined;
  const records: LuoguRawRecord[] = [];
  const rowPattern =
    /<(?:div|li|tr)\b[^>]*(?:class|data-v)[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']*\/record\/([^"']+))["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']*\/problem\/([^"']+))["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/(?:div|li|tr)>/gi;
  for (const match of text.matchAll(rowPattern)) {
    const title = match[6]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const problemId = decodeURIComponent(match[5] ?? "");
    if (!title || !problemId) continue;
    records.push({
      id: decodeURIComponent(match[2] ?? ""),
      problem: {
        pid: problemId,
        title: title.startsWith(problemId)
          ? title.slice(problemId.length).trim()
          : title,
      },
      problemUrl: new URL(match[3]!, LUOGU_ORIGIN).href,
    });
  }
  if (records.length > 0) return records;
  const problemPattern =
    /<a\b[^>]*href=["']([^"']*\/problem\/([^"']+))["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(problemPattern)) {
    const title = match[3]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const problemId = decodeURIComponent(match[2] ?? "");
    if (!title || !problemId) continue;
    const before = text.slice(0, match.index ?? 0);
    const recordMatches = [
      ...before.matchAll(
        /<a\b[^>]*href=["'][^"']*\/record\/([^"']+)["'][^>]*>/gi,
      ),
    ];
    const submissionId = recordMatches.at(-1)?.[1];
    if (!submissionId) continue;
    records.push({
      id: decodeURIComponent(submissionId),
      problem: { pid: problemId, title },
      problemUrl: new URL(match[1]!, LUOGU_ORIGIN).href,
    });
  }
  return records.length > 0 ? records : undefined;
}

function userValue(value: unknown): LuoguRawUser | undefined {
  const item = objectValue(value);
  if (!item) return undefined;
  const uid = item.uid ?? item.id;
  const name = item.name ?? item.username;
  if (uid === undefined && typeof name !== "string") return undefined;
  return {
    ...(uid !== undefined ? { uid: uid as number | string } : {}),
    ...(typeof name === "string" ? { name } : {}),
  };
}

function findPayload(value: unknown): Record<string, unknown> | undefined {
  const root = objectValue(value);
  if (!root) return undefined;
  const currentData = objectValue(root.currentData);
  if (currentData) return currentData;
  const data = objectValue(root.data);
  if (data) return data;
  return root;
}

function parseDocumentValue(text: string, contentType: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with HTML/encoded response extraction below.
  }

  const scriptMatch = trimmed.match(
    /<script[^>]+(?:id=["']lentille-context["'][^>]*)>([\s\S]*?)<\/script>/i,
  );
  if (scriptMatch?.[1]) {
    try {
      return JSON.parse(scriptMatch[1].trim());
    } catch {
      // Continue with the legacy encoded JSON form.
    }
  }

  const encodedMatch = trimmed.match(/decodeURIComponent\(\\?"([^"\n]+)\\?"\)/);
  if (encodedMatch?.[1]) {
    try {
      return JSON.parse(decodeURIComponent(encodedMatch[1]));
    } catch {
      // Fall through to a structured parse error.
    }
  }
  const records = htmlRecords(trimmed);
  if (records) return { records };
  throw new Error(`Unsupported Luogu response (${contentType || "unknown"})`);
}

function isLoginPayload(value: unknown): boolean {
  const root = objectValue(value);
  const payload = findPayload(value);
  const errorCode =
    root?.errorCode ??
    root?.status ??
    root?.code ??
    payload?.errorCode ??
    payload?.status ??
    payload?.code;
  if (Number(errorCode) === 401) return true;
  const errorType = String(
    root?.errorType ??
      payload?.errorType ??
      root?.errorMessage ??
      payload?.errorMessage ??
      "",
  );
  return /UserUnloginException|请先登录|login required/i.test(errorType);
}

export function parseLuoguPayload(
  value: unknown,
): LuoguParsedResponse | undefined {
  const root = objectValue(value);
  const payload = findPayload(value);
  if (!payload) return undefined;
  const records = recordArray(value);
  if (!records) return undefined;
  const recordsContainer = objectValue(payload.records);
  const user = userValue(payload.user);
  const currentUser = userValue(root?.currentUser ?? root?.user);
  const count = recordsContainer?.count ?? payload.count;
  const perPage = recordsContainer?.perPage ?? payload.perPage;
  return {
    records,
    ...(user ? { user } : {}),
    ...(currentUser ? { currentUser } : {}),
    ...(typeof count === "number" ? { count } : {}),
    ...(typeof perPage === "number" ? { perPage } : {}),
  };
}

export function parseLuoguDocument(
  text: string,
  contentType = "",
): LuoguParsedResponse {
  let value: unknown;
  try {
    value = parseDocumentValue(text, contentType);
  } catch (error) {
    if (error instanceof Error && /登录|login/i.test(text.slice(0, 5_000))) {
      throw new Error("Luogu response is a login page");
    }
    throw error;
  }
  if (isLoginPayload(value)) throw new Error("Luogu response is a login page");
  const parsed = parseLuoguPayload(value);
  if (!parsed) {
    throw new Error(`Unsupported Luogu response (${contentType || "unknown"})`);
  }
  return parsed;
}

export function parseLuoguIdentityDocument(
  text: string,
  contentType = "",
): LuoguRawUser {
  let value: unknown;
  try {
    value = parseDocumentValue(text, contentType);
  } catch (error) {
    if (error instanceof Error && /登录|login/i.test(text.slice(0, 5_000))) {
      throw new Error("Luogu response is a login page");
    }
    throw error;
  }
  if (isLoginPayload(value)) throw new Error("Luogu response is a login page");
  const root = objectValue(value);
  const payload = findPayload(value);
  const user = userValue(
    root?.currentUser ?? root?.user ?? payload?.currentUser ?? payload?.user,
  );
  if (!user || (user.uid === undefined && !user.name)) {
    throw new Error("Luogu response has no current user");
  }
  return user;
}
