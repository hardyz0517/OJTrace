const QOJ_ORIGIN = "https://qoj.ac";

function encodeUsername(username: string): string {
  const value = username.trim();
  if (!/^[a-zA-Z0-9_]{1,20}$/.test(value)) {
    throw new Error("QOJ username is invalid");
  }
  return value;
}

export function qojHomeUrl(): string {
  return `${QOJ_ORIGIN}/`;
}

export function qojSubmissionListUrl(username: string, page = 1): string {
  const value = encodeUsername(username);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
    throw new Error("QOJ page is invalid");
  }
  const params = new URLSearchParams({ submitter: value });
  if (page > 1) params.set("page", String(page));
  return `${QOJ_ORIGIN}/submissions?${params.toString()}`;
}

export function qojSubmissionUrl(id: string | number): string {
  const value = String(id);
  if (!/^[1-9][0-9]{0,9}$/.test(value)) {
    throw new Error("QOJ submission id is invalid");
  }
  return `${QOJ_ORIGIN}/submission/${value}`;
}
