import {
  isRulesResponse,
  type RulesCommand,
  type RulesPayload,
} from "../../src/application/cnoi-rules/messages";
import type { RuleIssue } from "../../src/domain/cnoi-rules";
export class RulesClientError extends Error {
  constructor(
    message: string,
    readonly issues: RuleIssue[] = [],
  ) {
    super(message);
  }
}
export async function sendRulesCommand(
  command: RulesCommand,
): Promise<RulesPayload> {
  const requestId = crypto.randomUUID();
  const response: unknown = await browser.runtime.sendMessage({
    ...command,
    schemaVersion: 1,
    requestId,
  });
  if (!isRulesResponse(response) || response.requestId !== requestId)
    throw new RulesClientError("规则服务响应无效，请刷新页面后重试。");
  if (!response.ok) throw new RulesClientError(response.error, response.issues);
  if (
    (command.type === "PREVIEW_CNOI_CONVERSION") !==
      (response.type === "CNOI_PREVIEW") ||
    (response.type === "CNOI_RULES" && response.state.source !== command.source)
  )
    throw new RulesClientError("规则服务响应与请求不匹配。");
  return response;
}
