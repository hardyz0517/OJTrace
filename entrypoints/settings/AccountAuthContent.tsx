import { sourceDefinitions } from "../../src/sources/definitions";
import type {
  AccountAuthMode,
  AuthModeDefinition,
  SourceId,
} from "../../src/domain";

export function modeLabel(mode: AccountAuthMode): string {
  return {
    "public-handle": "直接输入用户名",
    "browser-session": "使用当前浏览器登录状态",
    "manual-cookie": "手动配置",
    password: "账号密码登录",
  }[mode];
}

export function AccountAuthDescription({
  mode,
  source,
  sourceName,
}: {
  mode: AuthModeDefinition;
  source: SourceId;
  sourceName: string;
}) {
  const sourceLink = (
    <a
      className="auth-source-link"
      href={sourceDefinitions[source].officialHomeUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`打开 ${sourceName} 官网`}
    >
      {sourceName}
    </a>
  );
  if (mode.type === "browser-session") {
    return (
      <p className="auth-description">
        使用当前浏览器中已经登录的 {sourceLink} 账号。
      </p>
    );
  }
  if (mode.type === "manual-cookie") {
    return (
      <p className="auth-description">
        手动填写 {sourceLink} 账号的 Cookie，自动识别登录账号。Cookie
        仅保存在本地，用于验证身份和读取提交记录。
      </p>
    );
  }
  return mode.description ? (
    <p className="auth-description">{mode.description}</p>
  ) : null;
}
