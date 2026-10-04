import type { PartialReason, SourceId } from "../../domain";

const messages: Record<string, string> = {
  "source.activityInvalid": "部分活动缺少有效 ID 或标题，已跳过。",
  "source.authRequired": "登录状态已失效，请重新登录或授权。",
  "source.cookieMissing": "未读取到登录 Cookie，请确认已登录并授予站点权限。",
  "source.httpError": "站点拒绝了请求，或暂时无法访问。",
  "source.blocked": "站点暂时阻止了扩展请求。",
  "source.rateLimited": "请求过于频繁，请稍后重试。",
  "source.invalidResponse": "站点返回格式无法识别。",
  "source.invalidRecord": "部分提交记录缺少必要字段，已跳过。",
  "source.networkError": "无法连接站点，请检查网络后重试。",
  "source.timeout": "站点请求超时，请稍后重试。",
  "source.loginFailed": "用户名或密码错误，或登录被站点拒绝。",
  "source.brandingUnavailable": "未能更新站点图标，保留原图标。",
  "source.activityDiscoveryLimit":
    "待探测活动超过本次上限，每轮最多探测 50 项。",
  "source.activityCachedOutsideWindow":
    "根据 24 小时内核查的结束时间跳过范围外活动。",
  "source.activityLimit": "该活动已采集部分记录，达到本次分页或记录上限。",
  "source.activityUnvisited": "本次预算已用完，该活动尚未探测。",
  "source.recordLimit": "普通记录已达到本次分页或记录上限。",
  "source.outputLimit": "合并记录已达到本次总上限，仅保留最新提交。",
  "source.activityConflict": "同一记录关联多个活动，已保留首次识别的活动。",
  "source.paginationRepeated": "站点返回重复页，已停止分页并保留已采集记录。",
  "source.activityIdentityUnavailable": "未能确认用户 UID，暂时无法采集活动。",
  "source.unknownError": "同步失败，请稍后重试。",
  "sync.invalidRange": "同步时间范围无效，请选择最近 35 天内的范围。",
  "sync.windowContractViolation": "站点返回了范围外记录，已降级为部分同步。",
  "sync.deadline": "同步时间已到，请稍后重试。",
  "sync.partial": "已保留部分记录，请查看同步范围提示。",
  "sync.enrichmentIncomplete": "部分题名或执行指标未能补齐，基础记录已保留。",
  "sync.busy": "已有同步及待执行任务，请稍后重试。",
  "sync.freshness": "近期已尝试同步，本次跳过。",
  "sync.disabled": "账号已禁用，跳过首次同步。",
  "sync.cancelled": "同步已取消。",
  "sync.superseded": "账号授权已更新，旧同步已取消。",
  "account.operationSuperseded": "此授权操作已过期，请使用最新授权结果。",
  "account.cookieRequired": "请填写 Cookie。",
  "account.identifierRequired": "请填写账号标识。",
  "account.identityFromCookieRequired":
    "无法从 Cookie 识别账号，请确认 Cookie 有效。",
  "account.authModeUnsupported": "该账号接入方式暂不可用。",
  "account.loginCredentialsRequired": "请填写用户名和密码。",
  "account.credentialsRequired": "请填写全部必需凭证。",
  "account.credentialsInvalid": "凭证字段不符合该登录方式。",
  "account.invalidOrigin": "实例地址无效，请输入网站根地址或 /d/域名/ 地址。",
  "source.scopeMismatch": "站点返回了其他域的数据，已停止采集。请检查域地址。",
  "account.permissionRequired": "未授予站点权限，请重新授权。",
  "account.identityChanged": "当前登录账号发生变化，请重新授权。",
};

export const syncReasonLabels: Record<string, string> = {
  "record-limit": "记录额度已用完",
  "page-limit": "分页额度已用完",
  "activity-limit": "部分活动尚未读取",
  deadline: "任务时间已到",
  "pagination-repeated": "站点返回重复页",
  "unverified-coverage": "所选范围的记录完整性尚未验证",
  "invalid-record": "部分记录无法验证",
  "rate-limited": "站点限流",
  "activity-cache": "范围外活动使用缓存判断",
  unavailable: "部分页面暂时不可读",
};

export function syncCoverageNote(
  source: SourceId,
  reasons: readonly PartialReason[],
): string | undefined {
  if (reasons.includes("activity-cache"))
    return "部分历史活动根据 24 小时内缓存的结束时间跳过，未实时核查是否延期或重新开放。";
  if (!reasons.includes("unverified-coverage")) return undefined;
  return source === "atcoder"
    ? "AtCoder 返回的列表顺序异常，或同一秒的记录达到 500 条使时间游标无法继续；已保存当前记录。"
    : "已保存获取到的记录，尚无法确认所选时间范围完整覆盖。";
}

export function errorMessage(messageKey: string): string {
  return messages[messageKey] ?? "操作失败，请稍后重试。";
}
