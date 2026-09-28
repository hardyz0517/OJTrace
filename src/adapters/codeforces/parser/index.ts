export interface CodeforcesRawSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  problem?: {
    contestId?: number;
    index?: string;
    name?: string;
  };
  programmingLanguage?: string;
  verdict?: string;
}

export interface CodeforcesApiResponse {
  status: "OK" | "FAILED";
  comment?: string;
  result?: CodeforcesRawSubmission[];
}

export function parseCodeforcesResponse(text: string): CodeforcesApiResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Codeforces response is not JSON");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Codeforces response is not an object");
  }
  const response = value as Partial<CodeforcesApiResponse>;
  if (response.status !== "OK" && response.status !== "FAILED") {
    throw new Error("Codeforces response has invalid status");
  }
  if (response.status === "FAILED")
    return { status: "FAILED", comment: response.comment };
  if (!Array.isArray(response.result)) {
    throw new Error("Codeforces response has no result array");
  }
  return { status: "OK", result: response.result as CodeforcesRawSubmission[] };
}
