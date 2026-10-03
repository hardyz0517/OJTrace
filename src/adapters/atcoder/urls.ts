export const ATCODER_ORIGIN = "https://atcoder.jp";
export const ATCODER_PROBLEMS_ORIGIN = "https://kenkoooo.com";

export function atcoderHomeUrl(): string {
  return `${ATCODER_ORIGIN}/`;
}

export function atcoderUserSubmissionsUrl(
  handle: string,
  fromSecond = 0,
): string {
  const since = Number.isFinite(fromSecond)
    ? Math.max(0, Math.floor(fromSecond))
    : 0;
  return `${ATCODER_PROBLEMS_ORIGIN}/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(handle)}&from_second=${since}`;
}

export function atcoderUserUrl(handle: string): string {
  return `${ATCODER_ORIGIN}/users/${encodeURIComponent(handle)}`;
}

export function atcoderSubmissionUrl(contestId: string, id: string): string {
  return atcoderContestSubmissionUrl(contestId, id);
}

export function atcoderContestSubmissionUrl(
  contestId: string,
  id: string,
): string {
  return `${ATCODER_ORIGIN}/contests/${encodeURIComponent(contestId)}/submissions/${encodeURIComponent(id)}`;
}

export function atcoderSubmissionDetailUrl(
  contestId: string,
  submissionId: string,
): string {
  return atcoderContestSubmissionUrl(contestId, submissionId);
}

export function atcoderProblemsUrl(): string {
  return `${ATCODER_PROBLEMS_ORIGIN}/atcoder/resources/problems.json`;
}

export function atcoderProblemUrl(
  contestId: string,
  problemId: string,
): string {
  return `${ATCODER_ORIGIN}/contests/${encodeURIComponent(contestId)}/tasks/${encodeURIComponent(problemId)}`;
}
