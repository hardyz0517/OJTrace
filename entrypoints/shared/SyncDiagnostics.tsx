import {
  instanceBrandingFor,
  type PublicStoredData,
} from "../../src/application/accounts/account-queries";
import { errorMessage } from "../../src/application/messaging/error-messages";
import type { SyncSourceResult } from "../../src/application/sync/sync-service";
import "./SyncDiagnostics.css";

type SourceDiagnostics = Pick<
  SyncSourceResult,
  "accountId" | "source" | "diagnostics"
>;
const statusLabels: Record<string, string> = {
  synced: "已同步",
  empty: "所选时间范围内无可见记录",
  "permission-denied": "无权读取",
  "auth-required": "需要重新登录",
  unavailable: "暂时无法读取",
  truncated: "已同步部分记录，达到本次上限",
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
  if (!items.length) return null;
  const warningCount = items.filter(
    (item) => item.diagnostic.severity !== "info",
  ).length;
  const activityCount = new Set(
    items
      .filter((item) => item.diagnostic.context?.activityId)
      .map(
        (item) =>
          `${item.source.accountId}:${item.diagnostic.context!.activityId}`,
      ),
  ).size;
  return (
    <details className="sync-diagnostics">
      <summary>
        本次同步：{activityCount} 个活动，{warningCount} 项提示
      </summary>
      <ul>
        {items.map(({ source, diagnostic }, index) => {
          const account = data?.accounts.find(
            (item) => item.accountId === source.accountId,
          );
          const instance =
            account && data
              ? instanceBrandingFor(data, account)?.name
              : undefined;
          const status = diagnostic.context?.status;
          const detail = status
            ? (statusLabels[status] ?? errorMessage(diagnostic.messageKey))
            : errorMessage(diagnostic.messageKey);
          return (
            <li
              key={`${source.accountId}:${diagnostic.code}:${index}`}
              className={`diagnostic-${diagnostic.severity}`}
            >
              {instance ?? source.source} ·{" "}
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
