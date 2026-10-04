import {
  instanceBrandingFor,
  type PublicStoredData,
} from "../../src/application/accounts/account-queries";
import {
  errorMessage,
  syncReasonLabels,
  syncCoverageNote,
} from "../../src/application/messaging/error-messages";
import { adapterBySource } from "../../src/adapters";
import type { SyncSourceResult } from "../../src/application/sync/sync-service";
import "./SyncDiagnostics.css";

type SourceDiagnostics = Pick<
  SyncSourceResult,
  "accountId" | "source" | "diagnostics" | "coverage" | "skipped" | "error"
>;
const skipLabels: Record<string, string> = {
  freshness: "近期已尝试同步，本次跳过",
  busy: "已有同步及待执行任务，请稍后重试",
  disabled: "账号已禁用",
  superseded: "授权版本已更新",
  cancelled: "同步已取消",
};
const statusLabels: Record<string, string> = {
  synced: "已同步",
  empty: "所选时间范围内无可见记录",
  "permission-denied": "无权读取",
  "auth-required": "需要重新登录",
  unavailable: "暂时无法读取",
  truncated: "已同步部分记录，达到本次上限",
  "cached-outside-window": "根据缓存的结束时间跳过，未实时复查",
};

export function SyncDiagnostics({
  sources,
  data,
}: {
  sources: readonly SourceDiagnostics[];
  data: PublicStoredData | null;
}) {
  const items = sources.flatMap((source) =>
    source.diagnostics.map((diagnostic) => ({ source, diagnostic })),
  );
  const incomplete = sources.filter(
    (source) =>
      source.error ||
      source.skipped ||
      !source.coverage ||
      source.coverage.outcome.status === "partial",
  );
  if (!items.length && !incomplete.length) return null;
  const affectedAccounts = new Set([
    ...incomplete.map((source) => source.accountId),
    ...items
      .filter((item) => item.diagnostic.severity !== "info")
      .map((item) => item.source.accountId),
  ]).size;
  const activityCount = new Set(
    items
      .filter((item) => item.diagnostic.context?.activityId)
      .map(
        (item) =>
          `${item.source.accountId}:${item.diagnostic.context!.activityId}`,
      ),
  ).size;
  function sourceName(source: SourceDiagnostics): string {
    const account = data?.accounts.find(
      (item) => item.accountId === source.accountId,
    );
    return (
      (account && data
        ? (instanceBrandingFor(data, account)?.name ?? account.label)
        : undefined) ??
      adapterBySource.get(source.source)?.metadata.displayName ??
      source.source
    );
  }
  return (
    <details className="sync-diagnostics">
      <summary>
        本次同步 ·{" "}
        {affectedAccounts > 0
          ? `${affectedAccounts} 个账号需要查看`
          : "活动详情"}
        {activityCount > 0 && ` · ${activityCount} 个活动`}
      </summary>
      <ul>
        {incomplete.map((source) => (
          <li
            key={`coverage:${source.accountId}`}
            className="diagnostic-warning"
          >
            {sourceName(source)} ·{" "}
            {data?.accounts.find(
              (account) => account.accountId === source.accountId,
            )?.providerDisplayName ?? source.accountId}
            ：
            {source.error
              ? errorMessage(source.error.messageKey)
              : source.skipped
                ? skipLabels[source.skipped]
                : source.coverage?.outcome.status === "partial"
                  ? source.coverage.outcome.reasons.length === 1 &&
                    source.coverage.outcome.reasons[0] === "unverified-coverage"
                    ? `已获取 ${source.coverage.acceptedRecords} 条 · 完整性未验证`
                    : `未完整同步（${source.coverage.outcome.reasons.map((reason) => syncReasonLabels[reason] ?? reason).join("、")}），已获取 ${source.coverage.acceptedRecords} 条`
                  : "覆盖状态未知"}
            {!source.error &&
              source.coverage?.outcome.status === "partial" &&
              syncCoverageNote(
                source.source,
                source.coverage.outcome.reasons,
              ) && (
                <p className="sync-diagnostics-note">
                  {syncCoverageNote(
                    source.source,
                    source.coverage.outcome.reasons,
                  )}
                </p>
              )}
          </li>
        ))}
        {items.map(({ source, diagnostic }, index) => {
          const account = data?.accounts.find(
            (item) => item.accountId === source.accountId,
          );
          const status = diagnostic.context?.status;
          const detail = status
            ? (statusLabels[status] ?? errorMessage(diagnostic.messageKey))
            : errorMessage(diagnostic.messageKey);
          return (
            <li
              key={`${source.accountId}:${diagnostic.code}:${index}`}
              className={`diagnostic-${diagnostic.severity}`}
            >
              {sourceName(source)} ·{" "}
              {account?.providerDisplayName ?? account?.providerAccountKey}
              {diagnostic.context?.activityName &&
                ` · ${diagnostic.context.activityName}`}
              ：{detail}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
