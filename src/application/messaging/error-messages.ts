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
  "source.brandingUnavailable": "未能更新站点名称或图标，保留原展示。",
  "source.activityDiscoveryLimit":
    "参加过的活动超过本次采集上限，仅处理最近 50 项。",
  "source.activityLimit": "该活动已采集部分记录，达到本次分页或记录上限。",
  "source.recordLimit": "普通记录已达到本次分页或记录上限。",
  "source.outputLimit": "合并记录已达到本次总上限，仅保留最新提交。",
  "source.activityConflict": "同一记录关联多个活动，已保留首次识别的活动。",
  "source.paginationRepeated": "站点返回重复页，已停止分页并保留已采集记录。",
  "source.activityIdentityUnavailable": "未能确认用户 UID，暂时无法采集活动。",
  "source.unknownError": "同步失败，请稍后重试。",
  "account.cookieRequired": "请填写 Cookie。",
  "account.identifierRequired": "请填写账号标识。",
  "account.identityFromCookieRequired":
    "无法从 Cookie 识别账号，请确认 Cookie 有效。",
  "account.authModeUnsupported": "该账号接入方式暂不可用。",
  "account.loginCredentialsRequired": "请填写用户名和密码。",
  "account.credentialsRequired": "请填写全部必需凭证。",
  "account.credentialsInvalid": "凭证字段不符合该登录方式。",
  "account.invalidOrigin": "实例地址无效，请输入完整根地址。",
  "account.permissionRequired": "未授予站点权限，请重新授权。",
  "account.identityChanged": "当前登录账号发生变化，请重新授权。",
};

export function errorMessage(messageKey: string): string {
  return messages[messageKey] ?? "操作失败，请稍后重试。";
}
