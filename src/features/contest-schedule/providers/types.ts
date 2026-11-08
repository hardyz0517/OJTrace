import type { ContestPlatform } from "../core/types";
import type { HttpClient, HttpRequestOptions } from "../../../domain/adapter";

export class ContestProviderError extends Error {
  constructor(
    readonly platform: ContestPlatform,
    readonly kind: "network" | "http" | "invalid-response",
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ContestProviderError";
  }
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function requestTextWithClient(
  platform: ContestPlatform,
  url: string,
  http: Pick<HttpClient, "request">,
  options: HttpRequestOptions = {},
): Promise<string> {
  let response: Awaited<ReturnType<HttpClient["request"]>>;
  try {
    response = await http.request(platform, url, {
      method: "GET",
      ...options,
    });
  } catch (error) {
    const detail = error instanceof Error ? `（${error.message}）` : "";
    throw new ContestProviderError(
      platform,
      "network",
      `网络请求失败${detail}，请检查网络或站点访问权限后重试。`,
    );
  }
  if (response.status < 200 || response.status >= 300)
    throw new ContestProviderError(
      platform,
      "http",
      `站点返回 HTTP ${response.status}。`,
      response.status,
    );
  const expectedOrigins: Record<ContestPlatform, string> = {
    luogu: "https://www.luogu.com.cn",
    codeforces: "https://codeforces.com",
    atcoder: "https://atcoder.jp",
  };
  try {
    if (new URL(response.url || url).origin !== expectedOrigins[platform])
      throw new Error("redirected outside provider origin");
  } catch {
    throw new ContestProviderError(
      platform,
      "invalid-response",
      "比赛列表请求被重定向到不受支持的地址。",
    );
  }
  return response.text;
}

export async function requestText(
  platform: ContestPlatform,
  url: string,
  fetchImpl: FetchLike,
  options: {
    credentials?: RequestCredentials;
    redirect?: RequestRedirect;
    accept?: string;
  } = {},
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      credentials: options.credentials ?? "omit",
      redirect: options.redirect ?? "follow",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: options.accept ?? "application/json, text/html;q=0.9",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? `（${error.message}）` : "";
    throw new ContestProviderError(
      platform,
      "network",
      `网络请求失败${detail}，请检查网络或站点访问权限后重试。`,
    );
  }
  if (!response.ok)
    throw new ContestProviderError(
      platform,
      "http",
      `站点返回 HTTP ${response.status}。`,
      response.status,
    );
  const expectedOrigins: Record<ContestPlatform, string> = {
    luogu: "https://www.luogu.com.cn",
    codeforces: "https://codeforces.com",
    atcoder: "https://atcoder.jp",
  };
  try {
    if (new URL(response.url || url).origin !== expectedOrigins[platform])
      throw new Error("redirected outside provider origin");
  } catch {
    throw new ContestProviderError(
      platform,
      "invalid-response",
      "比赛列表请求被重定向到不受支持的地址。",
    );
  }
  try {
    return await response.text();
  } catch (error) {
    const detail = error instanceof Error ? `（${error.message}）` : "";
    throw new ContestProviderError(
      platform,
      "network",
      `读取比赛列表失败${detail}，请稍后重试。`,
    );
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function unixSecondsToMilliseconds(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    return undefined;
  const milliseconds = value * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}
