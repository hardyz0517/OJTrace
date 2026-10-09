import { sourceDefinitions } from "../../sources/definitions";
export const LUOGU_ORIGIN = sourceDefinitions.luogu.fixedOrigin;

export function luoguRecordListUrl(identifier: string, page = 1): string {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("Luogu page is invalid");
  }
  return `${LUOGU_ORIGIN}/record/list?user=${encodeURIComponent(identifier)}&page=${page}&_contentOnly=1`;
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
