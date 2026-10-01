export const LUOGU_ORIGIN = "https://www.luogu.com.cn";

export function luoguRecordListUrl(identifier: string): string {
  return `${LUOGU_ORIGIN}/record/list?user=${encodeURIComponent(identifier)}&page=1&_contentOnly=1`;
}

export function luoguRecordListBaseUrl(): string {
  return `${LUOGU_ORIGIN}/record/list`;
}

export function luoguUserSettingUrl(): string {
  return `${LUOGU_ORIGIN}/user/setting?_contentOnly=1`;
}

export function luoguSubmissionUrl(submissionId: string): string {
  return `${LUOGU_ORIGIN}/record/${encodeURIComponent(submissionId)}`;
}

export function luoguProblemUrl(problemId: string): string {
  return `${LUOGU_ORIGIN}/problem/${encodeURIComponent(problemId)}`;
}

export function luoguFallbackListUrl(providerAccountKey: string): string {
  return `${LUOGU_ORIGIN}/record/list?user=${encodeURIComponent(providerAccountKey)}`;
}
