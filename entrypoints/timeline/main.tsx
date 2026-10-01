import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Popover from "@radix-ui/react-popover";
import type { RuntimeResponse } from "../../src/application/messaging/messages";
import type { AccountConfig, StoredData, Submission } from "../../src/domain";
import {
  isAllowedNavigation,
  isAllowedOriginNavigation,
  ensureAdapterDataPermission,
} from "../../src/platform/permissions/hosts";
import { AppHeader } from "../shared/AppHeader";
import { OJLogo } from "../shared/OJLogo";
import "./style.css";

const sourceLabels: Record<Submission["source"], string> = {
  codeforces: "Codeforces",
  luogu: "洛谷",
  qoj: "QOJ",
  atcoder: "AtCoder",
  hydroj: "HydroOJ",
};

const sourceShortLabels: Record<Submission["source"], string> = {
  codeforces: "Codeforces",
  luogu: "洛谷",
  qoj: "QOJ",
  atcoder: "AtCoder",
  hydroj: "HydroOJ",
};

const verdictFilterOptions = [
  { value: "all" as const, label: "全部状态" },
  { value: "accepted" as const, label: "Accepted" },
  { value: "unaccepted" as const, label: "Unaccepted" },
];

type VerdictFilter = "all" | "accepted" | "unaccepted";

const sourceErrorMessages: Record<string, string> = {
  "source.authRequired": "后台请求未获得登录态，请检查账号登录状态后再同步。",
  "source.blocked": "站点暂时拒绝后台请求，请稍后重试。",
  "source.rateLimited": "请求过于频繁，请稍后重试。",
  "source.networkError": "后台请求失败，请检查网络、站点权限或登录状态后重试。",
  "source.cookieMissing":
    "未读取到登录 Cookie，请确认已登录站点并授予必要权限。",
  "source.timeout": "站点后台请求超时，请稍后重试。",
  "source.invalidResponse": "站点返回格式无法识别，请稍后重试。",
};

function OJName({
  source,
  children,
}: {
  source: Submission["source"];
  children: React.ReactNode;
}) {
  return (
    <span className="oj-name">
      <OJLogo source={source} size="tiny" />
      <span>{children}</span>
    </span>
  );
}

function request<T extends RuntimeResponse>(message: object): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

function syncErrorMessage(
  error: NonNullable<
    Extract<
      RuntimeResponse,
      { type: "SYNC_RESULT" }
    >["result"]["sources"][number]["error"]
  >,
): string {
  const sourceLabel = sourceLabels[error.source] ?? error.source;
  const detail =
    sourceErrorMessages[error.messageKey] ?? "同步失败，请稍后重试。";
  return `${sourceLabel}：${detail}`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function latestSuccessfulSyncAt(
  data: StoredData | null,
  selectedAccountIds?: string[],
): number | null {
  if (!data) return null;
  const selected = selectedAccountIds ? new Set(selectedAccountIds) : undefined;
  const timestamps = Object.entries(data.syncStates)
    .filter(([accountId]) => !selected || selected.has(accountId))
    .map(([, state]) => state.lastSuccessAt)
    .filter((timestamp): timestamp is number => Number.isFinite(timestamp));
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function formatSyncTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function dateKey(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function dateLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const day = startOfDay(date);
  const today = startOfDay(now);
  const dayDelta = Math.round((today - day) / (24 * 60 * 60 * 1000));
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
  if (dayDelta === 0) return `今天 · ${formatted}`;
  if (dayDelta === 1) return `昨天 · ${formatted}`;
  return formatted;
}

function verdictLabel(submission: Submission): string {
  const labels: Record<Submission["verdict"]["code"], string> = {
    accepted: "Accepted",
    wrong_answer: "Wrong Answer",
    compilation_error: "Compile Error",
    runtime_error: "Runtime Error",
    time_limit: "Time Limit Exceeded",
    memory_limit: "Memory Limit Exceeded",
    pending: "Pending",
    partial: "Unaccepted",
    rejected: "Unaccepted",
    skipped: "Skipped",
    other: submission.verdict.raw,
  };
  return labels[submission.verdict.code];
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes}B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)}KB`;
  return `${(bytes / 1_000_000).toFixed(1)}MB`;
}

function formatSubmissionTime(timeMs: number): string {
  return truncateMetricValue(
    timeMs >= 1_000 ? `${(timeMs / 1_000).toFixed(2)}s` : `${timeMs}ms`,
  );
}

function truncateMetricValue(value: string): string {
  const [number = value, unit = ""] = value
    .match(/^(.*?)([A-Za-z]+)$/)
    ?.slice(1) ?? [value, ""];
  const digits = number.replace(".", "");
  if (digits.length <= 5) return value;
  let cursor = 0;
  return (
    number
      .split("")
      .filter((character) => character === "." || cursor++ < 5)
      .join("") + unit
  );
}

function formatLanguage(language: string): string {
  return [...language].slice(0, 5).join("");
}

function SubmissionMetrics({ item }: { item: Submission }) {
  const metrics = [
    item.timeMs !== undefined
      ? {
          icon: "clock",
          value: formatSubmissionTime(item.timeMs),
          label: "耗时",
        }
      : undefined,
    item.memoryKb !== undefined
      ? {
          icon: "memory",
          value: truncateMetricValue(`${(item.memoryKb / 1_024).toFixed(2)}MB`),
          label: "空间",
        }
      : undefined,
    item.language
      ? {
          icon: "language",
          value: formatLanguage(item.language),
          label: "语言",
        }
      : undefined,
  ].filter((value): value is { icon: string; value: string; label: string } =>
    Boolean(value),
  );
  if (metrics.length === 0) return null;
  return (
    <span
      className="submission-metrics"
      title={metrics
        .map((metric) => `${metric.label}: ${metric.value}`)
        .join(" · ")}
    >
      {metrics.map((metric, index) => (
        <React.Fragment key={`${metric.icon}-${metric.value}-${index}`}>
          {index > 0 && <span className="metric-separator">/</span>}
          <span
            className={`metric metric-${metric.icon}`}
            aria-label={`${metric.label} ${metric.value}`}
          >
            <span className="metric-icon" aria-hidden="true" />
            <span>{metric.value}</span>
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

function groupByDate(items: Submission[]): Array<[string, Submission[]]> {
  const groups = new Map<string, Submission[]>();
  for (const item of items) {
    const key = dateKey(item.submittedAt);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

function navigationUrl(item: Submission): string | undefined {
  const candidate = item.submissionUrl ?? item.fallbackListUrl;
  return candidate &&
    (item.source === "hydroj"
      ? Boolean(item.origin)
      : isAllowedNavigation(item.source, candidate))
    ? candidate
    : undefined;
}

function reviewMarkdown(item: Submission): string {
  const problem = `${item.problemId} ${item.problemName || "未命名题目"}`;
  const problemLink = item.problemUrl
    ? `[${problem}](${item.problemUrl})`
    : problem;
  return item.submissionUrl
    ? `${problemLink} [(code)](${item.submissionUrl})`
    : problemLink;
}

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="5" y="2.5" width="8" height="10" rx="1.5" />
      <path d="M3.5 10.5h-1v-9h8v1" />
    </svg>
  );
}

async function copyReviewMarkdown(item: Submission): Promise<void> {
  const text = reviewMarkdown(item);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function CopyReviewButton({
  item,
  onCopied,
}: {
  item: Submission;
  onCopied: () => void;
}) {
  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget;
    await copyReviewMarkdown(item);
    onCopied();
    if (event.detail > 0) button.blur();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <button
      type="button"
      className="copy-review-button"
      aria-label="复制复盘 Markdown"
      title="复制复盘 Markdown"
      onClick={(event) => void handleClick(event)}
      onKeyDown={handleKeyDown}
    >
      <ClipboardIcon />
    </button>
  );
}

interface FilterOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
}

function AnimatedSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    setActiveIndex(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    setActiveIndex(index);
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      setActiveIndex(
        (index) => (index + delta + options.length) % options.length,
      );
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else setOpen(true);
    }
  }

  return (
    <div className="animated-select" ref={rootRef}>
      <button
        type="button"
        className={`select-trigger${open ? " is-open" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label}</span>
        <span className="select-chevron" aria-hidden="true" />
      </button>
      <div
        id={listId}
        className={`select-menu${open ? " is-open" : ""}`}
        role="listbox"
        aria-label={label}
        aria-hidden={!open}
      >
        {options.map((option, index) => (
          <button
            type="button"
            role="option"
            aria-selected={option.value === value}
            tabIndex={open ? 0 : -1}
            className={`select-option${option.value === value ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
            key={String(option.value)}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => choose(index)}
          >
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function accountDisplayName(account: AccountConfig): string {
  return (
    account.providerDisplayName?.trim() ||
    account.identifier.trim() ||
    "未命名账号"
  );
}

function SyncAccountPopover({
  accounts,
  selectedAccountIds,
  syncing,
  selectionSaving,
  onSync,
  onSelectionChange,
}: {
  accounts: AccountConfig[];
  selectedAccountIds: string[];
  syncing: boolean;
  selectionSaving: boolean;
  onSync: () => void;
  onSelectionChange: (accountIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedEnabledCount = accounts.filter(
    (account) =>
      account.enabled && selectedAccountIds.includes(account.accountId),
  ).length;
  const hasSelection = selectedEnabledCount > 0;

  function toggleAccount(account: AccountConfig): void {
    if (!account.enabled) return;
    const selected = selectedAccountIds.includes(account.accountId);
    onSelectionChange(
      selected
        ? selectedAccountIds.filter((id) => id !== account.accountId)
        : [...selectedAccountIds, account.accountId],
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="sync-split">
        <button
          className="quiet-action sync-button sync-main-button"
          type="button"
          onClick={() => {
            setOpen(false);
            onSync();
          }}
          disabled={syncing || selectionSaving || !hasSelection}
          title={hasSelection ? "同步已选择的账号" : "请至少选择一个可用账号"}
        >
          <span aria-hidden="true" className="action-icon">
            {syncing ? <span className="sync-spinner" /> : "↻"}
          </span>
          同步
        </button>
        <Popover.Trigger asChild>
          <button
            className={`quiet-action sync-button sync-menu-button${open ? " is-open" : ""}`}
            type="button"
            aria-label="选择同步账号"
            disabled={syncing}
          >
            <span className="select-chevron" aria-hidden="true" />
          </button>
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content
          className="sync-popover"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          aria-label="选择同步账号"
        >
          <div className="sync-popover-heading">
            <strong>同步账号</strong>
            <span>{selectedEnabledCount} 个已选</span>
          </div>
          {accounts.length === 0 ? (
            <p className="sync-popover-empty">还没有已连接账号</p>
          ) : (
            <div className="sync-account-list">
              {accounts.map((account) => {
                const checked = selectedAccountIds.includes(account.accountId);
                return (
                  <label
                    className={`sync-account-option${!account.enabled ? " is-disabled" : ""}`}
                    key={account.accountId}
                  >
                    <Checkbox.Root
                      className="sync-account-check"
                      checked={checked}
                      disabled={syncing || !account.enabled}
                      onCheckedChange={() => toggleAccount(account)}
                    >
                      <Checkbox.Indicator className="sync-account-check-icon">
                        <svg
                          viewBox="0 0 16 16"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="m3.5 8 3 3 6-6" />
                        </svg>
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                    <span className="sync-account-source">
                      {sourceLabels[account.source]}
                    </span>
                    <span className="sync-account-name">
                      {accountDisplayName(account)}
                    </span>
                    {!account.enabled && (
                      <span className="sync-account-status">未授权</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function App() {
  const [data, setData] = useState<StoredData | null>(null);
  const [source, setSource] = useState<Submission["source"] | "all">("all");
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  const [days, setDays] = useState(30);
  const [syncing, setSyncing] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectionSaving, setSelectionSaving] = useState(false);
  const selectionSaveQueue = useRef(Promise.resolve());
  const pendingSelectionSaves = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function selectionForData(nextData: StoredData): string[] {
    const configured = nextData.preferences.syncAccountIds;
    if (configured) {
      const validIds = new Set(
        nextData.accounts.map((account) => account.accountId),
      );
      return configured.filter((accountId) => validIds.has(accountId));
    }
    return nextData.accounts
      .filter((account) => account.enabled)
      .map((account) => account.accountId);
  }

  async function load(): Promise<void> {
    const response = await request<Extract<RuntimeResponse, { type: "STATE" }>>(
      {
        schemaVersion: 1,
        type: "GET_STATE",
        requestId: crypto.randomUUID(),
      },
    );
    if (response.ok) {
      setData(response.data);
      setSelectedAccountIds(selectionForData(response.data));
    }
  }

  function saveSelection(accountIds: string[]): void {
    const nextIds = [...new Set(accountIds)];
    setSelectedAccountIds(nextIds);
    setError(null);
    pendingSelectionSaves.current += 1;
    setSelectionSaving(true);
    selectionSaveQueue.current = selectionSaveQueue.current
      .then(async () => {
        const response = await request<RuntimeResponse>({
          schemaVersion: 1,
          type: "UPDATE_SYNC_ACCOUNTS",
          requestId: crypto.randomUUID(),
          accountIds: nextIds,
        });
        if (!response.ok || response.type !== "UPDATED") {
          throw new Error(
            response.ok ? "同步账号保存失败" : response.error.message,
          );
        }
        setData(response.data);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "同步账号保存失败");
      })
      .finally(() => {
        pendingSelectionSaves.current -= 1;
        if (pendingSelectionSaves.current === 0) setSelectionSaving(false);
      });
  }

  async function sync(): Promise<void> {
    const selectedAccounts =
      data?.accounts.filter(
        (account) =>
          account.enabled && selectedAccountIds.includes(account.accountId),
      ) ?? [];
    if (selectedAccounts.length === 0) {
      setError("请至少选择一个账号后再同步。");
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const hasAtCoderAccount = data?.accounts.some(
        (account) =>
          account.source === "atcoder" &&
          account.enabled &&
          selectedAccountIds.includes(account.accountId),
      );
      if (
        hasAtCoderAccount &&
        !(await ensureAdapterDataPermission("atcoder", {
          includeSource: false,
        }))
      ) {
        setError("未授予 AtCoder 详情页权限，无法读取内存数据。");
        return;
      }
      const response = await request<RuntimeResponse>({
        schemaVersion: 1,
        type: "SYNC_REQUEST",
        requestId: crypto.randomUUID(),
        force: true,
        accountIds: selectedAccounts.map((account) => account.accountId),
      });
      if (!response.ok || response.type !== "SYNC_RESULT") {
        throw new Error(
          response.ok ? "同步响应格式错误" : response.error.message,
        );
      }
      setData(response.result.data);
      setSelectedAccountIds(
        selectedAccounts.map((account) => account.accountId),
      );
      const requestedAccountIds = new Set(
        selectedAccounts.map((account) => account.accountId),
      );
      const failed = response.result.sources.filter(
        (item) =>
          item.error &&
          requestedAccountIds.has(item.accountId) &&
          selectedAccounts.some(
            (account) => account.accountId === item.accountId,
          ),
      );
      if (failed.length > 0) {
        const firstError = failed[0]?.error;
        setError(
          firstError
            ? failed.length === 1
              ? syncErrorMessage(firstError)
              : `${failed.length} 个来源同步失败，已保留本地缓存。`
            : `${failed.length} 个来源暂时不可用，已保留本地缓存。`,
        );
      } else {
        setError(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 1_400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const visible = useMemo(() => {
    if (!data) return [];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1_000;
    return data.submissions.filter((item) => {
      return (
        (source === "all" || item.source === source) &&
        (verdict === "all" ||
          (verdict === "accepted"
            ? item.verdict.code === "accepted"
            : item.verdict.code !== "accepted")) &&
        item.submittedAt >= cutoff
      );
    });
  }, [data, days, source, verdict]);
  const lastSuccessfulSyncAt = latestSuccessfulSyncAt(data, selectedAccountIds);

  return (
    <main className="shell">
      <AppHeader active="timeline" />
      <div className="timeline-page-content">
        <section className="filters" aria-label="筛选">
          <div className="filter-controls">
            <AnimatedSelect
              label="OJ 筛选"
              value={source}
              onChange={setSource}
              options={[
                { value: "all" as const, label: "全部 OJ" },
                ...Object.entries(sourceLabels).map(([value, label]) => ({
                  value: value as Submission["source"],
                  label: (
                    <OJName source={value as Submission["source"]}>
                      {label}
                    </OJName>
                  ),
                })),
              ]}
            />
            <AnimatedSelect
              label="时间筛选"
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: "最近 7 天" },
                { value: 30, label: "最近 30 天" },
                { value: 365, label: "最近一年" },
                { value: 36500, label: "全部本地记录" },
              ]}
            />
            <AnimatedSelect
              label="状态筛选"
              value={verdict}
              onChange={setVerdict}
              options={verdictFilterOptions}
            />
          </div>
          <div className="filter-actions">
            <span className="sync-state">
              {lastSuccessfulSyncAt
                ? `上次同步 ${formatSyncTime(lastSuccessfulSyncAt)}`
                : "尚未同步"}
            </span>
            <SyncAccountPopover
              accounts={data?.accounts ?? []}
              selectedAccountIds={selectedAccountIds}
              syncing={syncing}
              selectionSaving={selectionSaving}
              onSync={() => void sync()}
              onSelectionChange={saveSelection}
            />
          </div>
        </section>

        {error && <p className="notice">{error}</p>}

        {!data && <p className="empty">正在读取本地数据…</p>}
        {data && visible.length === 0 && (
          <p className="empty">暂无提交记录。请先在设置中添加账号。</p>
        )}
        <section className="timeline">
          {groupByDate(visible).map(([day, items]) => (
            <section className="day" key={day}>
              <h2>{items[0] ? dateLabel(items[0].submittedAt) : day}</h2>
              {items.map((item) =>
                navigationUrl(item) ? (
                  <a
                    className="row"
                    href={navigationUrl(item)}
                    target="_blank"
                    rel="noreferrer"
                    key={`${item.source}:${item.accountId}:${item.submissionId}`}
                  >
                    <time>{formatTime(item.submittedAt)}</time>
                    <span className="source">
                      <OJName source={item.source}>
                        {sourceShortLabels[item.source]}
                      </OJName>
                    </span>
                    <span className="problem-cell">
                      {item.problemUrl &&
                      (item.source === "hydroj" && item.origin
                        ? isAllowedOriginNavigation(
                            item.source,
                            item.origin,
                            item.problemUrl,
                          )
                        : isAllowedNavigation(item.source, item.problemUrl)) ? (
                        <a
                          className="problem-link"
                          href={item.problemUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span className="problem-id">{item.problemId}</span>
                          <span className="problem-name">
                            {item.problemName || "未命名题目"}
                          </span>
                        </a>
                      ) : (
                        <>
                          <span className="problem-id">{item.problemId}</span>
                          <span className="problem-name">
                            {item.problemName || "未命名题目"}
                          </span>
                        </>
                      )}
                    </span>
                    <span className="verdict-cell">
                      <span className={`verdict verdict-${item.verdict.code}`}>
                        {verdictLabel(item)}
                      </span>
                      {item.score !== undefined && (
                        <span
                          className="score"
                          aria-label={`得分 ${item.score}`}
                        >
                          {item.score}
                        </span>
                      )}
                    </span>
                    <SubmissionMetrics item={item} />
                    <span className="row-actions">
                      <CopyReviewButton
                        item={item}
                        onCopied={() => setToast("已复制")}
                      />
                    </span>
                  </a>
                ) : (
                  <div
                    className="row row-disabled"
                    key={`${item.source}:${item.accountId}:${item.submissionId}`}
                  >
                    <time>{formatTime(item.submittedAt)}</time>
                    <span className="source">
                      <OJName source={item.source}>
                        {sourceShortLabels[item.source]}
                      </OJName>
                    </span>
                    <span className="problem-cell">
                      <span className="problem-id">{item.problemId}</span>
                      <span className="problem-name">未提供题目名称</span>
                    </span>
                    <span className="verdict-cell">
                      <span className="verdict verdict-other">链接不可用</span>
                      {item.score !== undefined && (
                        <span
                          className="score"
                          aria-label={`得分 ${item.score}`}
                        >
                          {item.score}
                        </span>
                      )}
                    </span>
                    <SubmissionMetrics item={item} />
                    <span className="row-actions">
                      <CopyReviewButton
                        item={item}
                        onCopied={() => setToast("已复制")}
                      />
                    </span>
                  </div>
                ),
              )}
            </section>
          ))}
        </section>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
