import { MESSAGE_SCHEMA_VERSION } from "../../src/domain/types";
import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../../src/application/messaging/messages";
import {
  isRuntimeResponse,
  responseMatchesRequest,
} from "../../src/application/messaging/response-guards";

type WithoutEnvelope<Message> = Message extends RuntimeMessage
  ? Omit<Message, "schemaVersion" | "requestId">
  : never;
export type RuntimeCommand = WithoutEnvelope<RuntimeMessage> & {
  schemaVersion?: never;
  requestId?: never;
};

export function createRuntimeRequestId(): string {
  return crypto.randomUUID();
}

export function createRuntimeMessage<Command extends RuntimeCommand>(
  command: Command,
  requestId = createRuntimeRequestId(),
) {
  return { ...command, schemaVersion: MESSAGE_SCHEMA_VERSION, requestId };
}

export class RuntimeClientError extends Error {
  constructor(
    readonly code: "transport" | "invalid_response" | "response_mismatch",
    options?: ErrorOptions,
  ) {
    super(
      code === "transport"
        ? "消息发送失败，请稍后重试。"
        : "后台响应格式错误，请刷新后重试。",
      options,
    );
    this.name = "RuntimeClientError";
  }
}

/** One dispatch per command: a lost response never authorizes an automatic retry. */
export async function sendRuntimeMessage(
  message: RuntimeMessage,
): Promise<RuntimeResponse> {
  let response: unknown;
  try {
    response = await browser.runtime.sendMessage(message);
  } catch (cause) {
    throw new RuntimeClientError("transport", { cause });
  }
  if (!isRuntimeResponse(response))
    throw new RuntimeClientError("invalid_response");
  if (!responseMatchesRequest(response, message))
    throw new RuntimeClientError("response_mismatch");
  return response;
}
