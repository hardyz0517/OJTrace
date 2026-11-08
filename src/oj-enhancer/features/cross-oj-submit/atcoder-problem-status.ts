import type { AtCoderProblemRef, ProblemHistoryStatus } from "./model";
import { queryCrossOjRecords } from "./cross-oj-records";

export interface AtCoderProblemHistoryQueryResult {
  status: ProblemHistoryStatus;
  message?: string;
}

/** Query the full contest-to-date history so accepted status is not missed. */
export async function queryAtCoderProblemHistoryStatus(input: {
  handles: readonly string[];
  problem: AtCoderProblemRef;
  requestPage: (url: string) => Promise<unknown>;
}): Promise<AtCoderProblemHistoryQueryResult> {
  if (!input.handles.length)
    return {
      status: "unavailable",
      message: "请先在 OJTrace 中配置并启用 AtCoder 账号。",
    };
  const result = await queryCrossOjRecords({
    handles: input.handles,
    problem: input.problem,
    requestPage: input.requestPage,
    stopOnAccepted: true,
  });
  if (result.records.some((record) => record.evaluationStatus === "accepted"))
    return { status: "accepted" };
  if (result.incomplete || result.message)
    return {
      status: "unavailable",
      message: result.message
        ? `AtCoder 查询不完整：${result.message}`
        : "AtCoder 提交记录尚未完整扫描，无法确认历史状态。",
    };
  return {
    status: result.records.length ? "unaccepted" : "none",
  };
}
