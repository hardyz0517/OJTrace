import {
  PROBLEM_EXPORT_SCHEMA_VERSION,
  type ProblemExportFallbackJob,
  type ProblemExportPortRequest,
} from "./messages";

export const PROBLEM_EXPORT_PORT_NAME = "problem-export" as const;

export function createProblemExportConnectMessage(
  token: string,
  job?: ProblemExportFallbackJob,
): ProblemExportPortRequest {
  return {
    schemaVersion: PROBLEM_EXPORT_SCHEMA_VERSION,
    type: "PROBLEM_EXPORT_CONNECT",
    requestId: crypto.randomUUID(),
    token,
    ...(job ? { job } : {}),
  };
}
