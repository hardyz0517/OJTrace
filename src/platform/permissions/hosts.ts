import type { SourceId } from "../../domain";

export const SOURCE_ORIGINS: Record<SourceId, string[]> = {
  codeforces: ["https://codeforces.com/*"],
  luogu: ["https://www.luogu.com.cn/*"],
  qoj: ["https://qoj.ac/*"],
  loj: ["https://loj.ac/*"],
};

export async function hasSourcePermission(source: SourceId): Promise<boolean> {
  return browser.permissions.contains({ origins: SOURCE_ORIGINS[source] });
}

export async function requestSourcePermission(
  source: SourceId,
): Promise<boolean> {
  return browser.permissions.request({ origins: SOURCE_ORIGINS[source] });
}

export function isAllowedNavigation(source: SourceId, rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return SOURCE_ORIGINS[source].some((pattern) => {
      const origin = new URL(pattern.replace("/*", "")).origin;
      return url.origin === origin;
    });
  } catch {
    return false;
  }
}
