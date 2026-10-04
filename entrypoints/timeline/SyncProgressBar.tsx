import { Fragment, useEffect, useId, useState } from "react";
import { AlertTriangle, Check, ChevronDown, RefreshCw, X } from "lucide-react";
import type { AccountConfig, AccountSyncProgress } from "../../src/domain";
import {
  errorMessage,
  syncReasonLabels,
  syncCoverageNote,
} from "../../src/application/messaging/error-messages";
import type { SyncRunProgress } from "./useSyncProgress";
import "./SyncProgressBar.css";

function stageLabel(account: AccountSyncProgress): string {
  if (account.status !== "running") {
    if (
      account.status === "partial" &&
      account.reasons?.length === 1 &&
      account.reasons[0] === "unverified-coverage"
    )
      return `完整性未验证 · ${account.recordsFetched} 条`;
    const status = {
      complete: "已完成",
      partial: "未完整同步",
      failed: "同步失败",
      skipped: "已跳过",
      cancelled: "已取消",
    }[account.status];
    return `${status} · ${account.recordsFetched} 条`;
  }
  switch (account.phase) {
    case "queued":
      return "等待同步";
    case "identity":
      return "正在连接";
    case "branding":
      return "正在收尾";
    case "details":
      return account.detailsTotal === undefined
        ? "正在读取详情"
        : `详情 ${account.detailsCompleted ?? 0} / ${account.detailsTotal}`;
    case "activities":
      return account.activitiesTotal === undefined
        ? "正在查找活动"
        : `已完成 ${account.activitiesCompleted ?? 0} / ${account.activitiesTotal} 个活动`;
    default:
      return account.pagesFetched === 0 ||
        account.source === "codeforces" ||
        account.source === "atcoder"
        ? "正在读取记录"
        : account.pageEstimate !== undefined
          ? `第 ${account.pagesFetched} 页 · 预计约 ${account.pageEstimate} 页`
          : `已扫描 ${account.pagesFetched} 页 · 继续查找中`;
  }
}

function StageProgress({
  account,
  label,
}: {
  account: AccountSyncProgress;
  label: string;
}) {
  if (account.status !== "running") return null;
  const total =
    account.phase === "details"
      ? account.detailsTotal
      : account.phase === "activities"
        ? account.activitiesTotal
        : undefined;
  const completed =
    account.phase === "details"
      ? account.detailsCompleted
      : account.phase === "activities"
        ? account.activitiesCompleted
        : undefined;
  const exact = total !== undefined && total > 0;
  if (total === 0) return null;
  const value = exact ? Math.min(total, completed ?? 0) : undefined;
  return (
    <div
      className={`sync-stage-track${exact ? "" : " is-indeterminate"}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={exact ? 0 : undefined}
      aria-valuemax={exact ? total : undefined}
      aria-valuenow={value}
      aria-valuetext={stageLabel(account)}
    >
      <span
        style={exact ? { width: `${(value! / total!) * 100}%` } : undefined}
      />
    </div>
  );
}

export function SyncProgressBar({
  run,
  renderAccount,
  onDismiss,
}: {
  run: SyncRunProgress;
  renderAccount: (account: AccountConfig) => React.ReactNode;
  onDismiss: (requestId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const complete = run.accounts.filter(
    (account) => account.status !== "running",
  ).length;
  const incomplete = run.accounts.filter(
    (account) => account.status !== "running" && account.status !== "complete",
  ).length;
  const records = run.accounts.reduce(
    (sum, account) => sum + account.recordsFetched,
    0,
  );
  const warning = !run.running && (incomplete > 0 || Boolean(run.interruption));
  const summary = run.running
    ? [
        "正在同步 ·",
        `${complete} / ${run.accounts.length} 个账号已完成 ·`,
        `已获取 ${records} 条记录`,
      ]
    : run.interruption
      ? ["同步中断 ·", `${incomplete} 个账号未完整同步`]
      : warning
        ? ["同步完成 ·", `${incomplete} 个账号未完整同步`]
        : ["同步完成 ·", `新增 ${run.addedRecords} 条记录`];

  useEffect(() => {
    if (run.running || warning || expanded) return;
    const timer = window.setTimeout(() => onDismiss(run.requestId), 3_500);
    return () => window.clearTimeout(timer);
  }, [run.running, run.requestId, warning, expanded, onDismiss]);

  return (
    <section
      className={`sync-progress${warning ? " has-warning" : ""}`}
      aria-label="同步进度"
    >
      <div className="sync-progress-heading">
        <button
          type="button"
          className="sync-progress-toggle"
          aria-expanded={expanded}
          aria-controls={detailsId}
          title={expanded ? "收起同步详情" : "展开同步详情"}
          onClick={() => setExpanded((value) => !value)}
        >
          {run.running ? (
            <RefreshCw className="sync-progress-spin" aria-hidden="true" />
          ) : warning ? (
            <AlertTriangle aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          <span
            className="sync-progress-summary"
            role="status"
            aria-live="polite"
          >
            {summary.map((text, index) => (
              <Fragment key={index}>
                {index > 0 && " "}
                <span>{text}</span>
              </Fragment>
            ))}
          </span>
          <ChevronDown className="sync-progress-chevron" aria-hidden="true" />
        </button>
        {!run.running && (
          <button
            type="button"
            className="sync-progress-dismiss"
            aria-label="关闭同步进度"
            title="关闭同步进度"
            onClick={() => onDismiss(run.requestId)}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      <div id={detailsId} hidden={!expanded} className="sync-progress-details">
        {run.accounts.map((account) => {
          const config = run.accountConfigs.find(
            (item) => item.accountId === account.accountId,
          )!;
          const reasons = [
            ...(account.messageKey ? [errorMessage(account.messageKey)] : []),
            ...(account.reasons ?? []).map(
              (reason) => syncReasonLabels[reason] ?? reason,
            ),
            ...(account.diagnostics ?? [])
              .filter((item) => item.severity !== "info")
              .map(
                (item) =>
                  `${item.context?.activityName ? `${item.context.activityName}：` : ""}${errorMessage(item.messageKey)}`,
              ),
            ...(run.interruption && account.status !== "complete"
              ? [run.interruption]
              : []),
          ];
          const coverageNote = syncCoverageNote(
            account.source,
            account.reasons ?? [],
          );
          return (
            <div
              className={`sync-progress-account status-${account.status}`}
              key={account.accountId}
            >
              <div className="sync-progress-account-heading">
                <span className="sync-progress-account-name">
                  {renderAccount(config)}
                </span>
                <span className="sync-progress-stage">
                  {account.status === "complete" && (
                    <Check aria-hidden="true" />
                  )}
                  {stageLabel(account)}
                </span>
              </div>
              <StageProgress
                account={account}
                label={`${config.providerDisplayName ?? config.providerAccountKey} 同步进度`}
              />
              <div className="sync-progress-stats">
                {account.status === "running" && (
                  <span>已获取 {account.recordsFetched} 条记录</span>
                )}
                {account.pagesFetched > 0 && (
                  <span>已扫描 {account.pagesFetched} 页</span>
                )}
                {account.phase !== "activities" &&
                  account.activitiesTotal !== undefined && (
                    <span>
                      活动 {account.activitiesCompleted ?? 0} /{" "}
                      {account.activitiesTotal}
                    </span>
                  )}
                {account.phase !== "details" &&
                  account.detailsTotal !== undefined && (
                    <span>
                      详情 {account.detailsCompleted ?? 0} /{" "}
                      {account.detailsTotal}
                    </span>
                  )}
              </div>
              {reasons.length > 0 && (
                <p className="sync-progress-reasons">
                  {[...new Set(reasons)].join("；")}
                </p>
              )}
              {coverageNote && (
                <p className="sync-progress-coverage-note">{coverageNote}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
