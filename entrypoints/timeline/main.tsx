import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Popover from "@radix-ui/react-popover";
import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../../src/application/messaging/messages";
import type { AccountConfig, Submission } from "../../src/domain";
import {
  isSyncRangePreference,
  MAX_SYNC_LOOKBACK_DAYS,
} from "../../src/domain/sync-range";
import { errorMessage } from "../../src/application/messaging/error-messages";
import { hydroOJLanguageDisplayName } from "../../src/adapters/hydroj/normalizer";
import { latestSubmissionsPerProblem } from "../../src/domain/submission-filter";
import {
  isAllowedNavigation,
  isAllowedOriginNavigation,
  ensureAdapterDataPermission,
} from "../../src/platform/permissions/hosts";
import { AppHeader } from "../shared/AppHeader";
import { OJName } from "../shared/OJName";
import { DateTimeRangePicker } from "../shared/DateTimeRangePicker";
import {
  quickDateTimeRange,
  resolveDateTimeRange,
  type DateTimeRange,
} from "../shared/date-time-range";
import {
  instanceBrandingFor,
  type PublicStoredData,
} from "../../src/application/accounts/account-queries";
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

const submissionFilterOptions = [
  { value: "all" as const, label: "全部提交" },
  { value: "latest" as const, label: "每题最后一次" },
];

type SubmissionFilter = "all" | "latest";

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
  const detail = errorMessage(error.messageKey);
  return `${sourceLabel}：${detail}`;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function latestSuccessfulSyncAt(
  data: PublicStoredData | null,
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
  if (dateKey(timestamp) === dateKey(Date.now())) return formatTime(timestamp);
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

function activityTypeLabel(item: Submission): string {
  return item.activityType === "homework"
    ? "作业"
    : item.activityType === "contest"
      ? "比赛"
      : "活动";
}

function formatSubmissionTime(timeMs: number): string {
  return truncateMetricValue(
    timeMs >= 1_000
      ? `${(timeMs / 1_000).toFixed(2)}s`
      : `${Math.trunc(timeMs)}ms`,
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

function formatLanguage(
  language: string,
  source: Submission["source"],
): string {
  const displayName =
    source === "hydroj"
      ? (hydroOJLanguageDisplayName(language) ?? language.trim())
      : language.trim();
  return [...displayName].slice(0, 5).join("");
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
          value: formatLanguage(item.language, item.source),
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
  if (!candidate) return undefined;
  if (item.source === "hydroj") {
    return item.origin &&
      isAllowedOriginNavigation(item.source, item.origin, candidate)
      ? candidate
      : undefined;
  }
  return isAllowedNavigation(item.source, candidate) ? candidate : undefined;
}

function ojHomeUrl(item: Submission): string | undefined {
  if (item.source === "hydroj") {
    if (!item.origin) return undefined;
    try {
      return `${new URL(item.origin).origin}/`;
    } catch {
      return undefined;
    }
  }

  const homeUrls: Record<Exclude<Submission["source"], "hydroj">, string> = {
    codeforces: "https://codeforces.com/",
    luogu: "https://www.luogu.com.cn/",
    qoj: "https://qoj.ac/",
    atcoder: "https://atcoder.jp/",
  };
  return homeUrls[item.source];
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

  return (
    <button
      type="button"
      className="copy-review-button"
      aria-label="复制复盘 Markdown"
      title="复制复盘 Markdown"
      onClick={(event) => void handleClick(event)}
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
    account.providerAccountKey?.trim() ||
    "未命名账号"
  );
}

function sourceDisplayName(
  data: PublicStoredData | null,
  item: Submission,
): string {
  return (
    (data ? instanceBrandingFor(data, item)?.name : undefined) ??
    sourceShortLabels[item.source]
  );
}

function SyncAccountPopover({
  accounts,
  selectedAccountIds,
  syncing,
  selectionSaving,
  onSelectionChange,
}: {
  accounts: AccountConfig[];
  selectedAccountIds: string[];
  syncing: boolean;
  selectionSaving: boolean;
  onSelectionChange: (accountIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedEnabledCount = accounts.filter(
    (account) =>
      account.enabled && selectedAccountIds.includes(account.accountId),
  ).length;

  function setAccountChecked(
    account: AccountConfig,
    nextChecked: boolean,
  ): void {
    if (!account.enabled) return;
    const nextIds = nextChecked
      ? selectedAccountIds.includes(account.accountId)
        ? selectedAccountIds
        : [...selectedAccountIds, account.accountId]
      : selectedAccountIds.filter((id) => id !== account.accountId);
    onSelectionChange(nextIds);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className={`quiet-action sync-option-button${open ? " is-open" : ""}`}
          type="button"
          aria-label="选择同步账号"
          disabled={syncing || selectionSaving}
        >
          <span>{selectedEnabledCount} 个账号</span>
          <span className="select-chevron" aria-hidden="true" />
        </button>
      </Popover.Trigger>
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
                  <div
                    className={`sync-account-option${!account.enabled ? " is-disabled" : ""}`}
                    key={account.accountId}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("button"))
                        return;
                      setAccountChecked(account, !checked);
                    }}
                  >
                    <Checkbox.Root
                      className="sync-account-check"
                      aria-label={`${sourceLabels[account.source]} ${accountDisplayName(account)}`}
                      checked={checked}
                      disabled={syncing || !account.enabled}
                      onCheckedChange={(nextChecked) =>
                        setAccountChecked(account, nextChecked === true)
                      }
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
                  </div>
                );
              })}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function syncRangeForData(data: PublicStoredData): DateTimeRange {
  return data.preferences.syncRange ?? quickDateTimeRange(7);
}

function allowedRowUrl(item: Submission, url?: string): string | undefined {
  if (!url) return undefined;
  const allowed =
    item.source === "hydroj"
      ? item.origin && isAllowedOriginNavigation(item.source, item.origin, url)
      : isAllowedNavigation(item.source, url);
  return allowed ? url : undefined;
}

function TimelineRow({
  item,
  data,
  onCopied,
}: {
  item: Submission;
  data: PublicStoredData | null;
  onCopied: () => void;
}) {
  const recordUrl = navigationUrl(item);
  const homeUrl = allowedRowUrl(item, ojHomeUrl(item));
  const problemUrl = allowedRowUrl(item, item.problemUrl);
  const activityUrl = allowedRowUrl(item, item.activityUrl);
  const problem = (
    <>
      <span className="problem-id">{item.problemId}</span>
      <span className="problem-name">{item.problemName || "未命名题目"}</span>
    </>
  );
  const activity = `${activityTypeLabel(item)} · ${item.activityName}`;
  const branding = data ? instanceBrandingFor(data, item) : undefined;
  const sourceContent = (
    <OJName source={item.source} iconDataUrl={branding?.iconDataUrl}>
      {sourceDisplayName(data, item)}
    </OJName>
  );
  return (
    <div className={`row${recordUrl ? "" : " row-disabled"}`}>
      {recordUrl && (
        <a
          className="row-target"
          href={recordUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`查看 ${item.problemId} 的提交记录`}
        />
      )}
      <time>{formatTime(item.submittedAt)}</time>
      {homeUrl ? (
        <a
          className="source source-link"
          href={homeUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`打开 ${sourceDisplayName(data, item)} 首页`}
        >
          {sourceContent}
        </a>
      ) : (
        <span className="source">{sourceContent}</span>
      )}
      <span className="problem-cell">
        {problemUrl ? (
          <a
            className="problem-link"
            href={problemUrl}
            target="_blank"
            rel="noreferrer"
          >
            {problem}
          </a>
        ) : (
          <span className="problem-link">{problem}</span>
        )}
        {item.activityName &&
          (activityUrl ? (
            <a
              className="activity-label activity-link"
              href={activityUrl}
              target="_blank"
              rel="noreferrer"
            >
              {activity}
            </a>
          ) : (
            <span className="activity-label">{activity}</span>
          ))}
      </span>
      <span className="verdict-cell">
        <span className={`verdict verdict-${item.verdict.code}`}>
          {verdictLabel(item)}
        </span>
        {item.score !== undefined && (
          <span className="score" aria-label={`得分 ${item.score}`}>
            {item.score}
          </span>
        )}
      </span>
      <SubmissionMetrics item={item} />
      <span className="row-actions">
        <CopyReviewButton item={item} onCopied={onCopied} />
      </span>
    </div>
  );
}

function App() {
  const [data, setData] = useState<PublicStoredData | null>(null);
  const [source, setSource] = useState<Submission["source"] | "all">("all");
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  const [submissionFilter, setSubmissionFilter] =
    useState<SubmissionFilter>("all");
  const [timeRange, setTimeRange] = useState(() => quickDateTimeRange(30));
  const [syncRange, setSyncRange] = useState<DateTimeRange>(() =>
    quickDateTimeRange(7),
  );
  const [timeFilterNow, setTimeFilterNow] = useState(Date.now);
  const [syncing, setSyncing] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [selectionSaving, setSelectionSaving] = useState(false);
  const selectionSaveQueue = useRef(Promise.resolve());
  const pendingSelectionSaves = useRef(0);
  const savedData = useRef<PublicStoredData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function selectionForData(nextData: PublicStoredData): string[] {
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
        schemaVersion: 2,
        type: "GET_STATE",
        requestId: crypto.randomUUID(),
      },
    );
    if (response.ok) {
      savedData.current = response.data;
      setData(response.data);
      setSelectedAccountIds(selectionForData(response.data));
      setSyncRange(syncRangeForData(response.data));
    }
  }

  function saveSelection(accountIds: string[]): void {
    const nextIds = [...new Set(accountIds)];
    setSelectedAccountIds(nextIds);
    saveSyncPreference(
      {
        schemaVersion: 2,
        type: "UPDATE_SYNC_ACCOUNTS",
        requestId: crypto.randomUUID(),
        accountIds: nextIds,
      },
      "同步账号保存失败",
    );
  }

  function saveRange(range: DateTimeRange): void {
    if (!isSyncRangePreference(range)) return;
    setSyncRange(range);
    saveSyncPreference(
      {
        schemaVersion: 2,
        type: "UPDATE_SYNC_RANGE",
        requestId: crypto.randomUUID(),
        range,
      },
      "采集范围保存失败",
    );
  }

  function saveSyncPreference(
    message: Extract<
      RuntimeMessage,
      { type: "UPDATE_SYNC_ACCOUNTS" | "UPDATE_SYNC_RANGE" }
    >,
    failureMessage: string,
  ): void {
    setError(null);
    pendingSelectionSaves.current += 1;
    setSelectionSaving(true);
    selectionSaveQueue.current = selectionSaveQueue.current
      .then(async () => {
        const response = await request<RuntimeResponse>(message);
        if (!response.ok || response.type !== "UPDATED") {
          throw new Error(
            response.ok ? failureMessage : response.error.message,
          );
        }
        savedData.current = response.data;
        setData(response.data);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : failureMessage);
      })
      .finally(() => {
        pendingSelectionSaves.current -= 1;
        if (pendingSelectionSaves.current === 0) {
          if (savedData.current) {
            setSelectedAccountIds(selectionForData(savedData.current));
            setSyncRange(syncRangeForData(savedData.current));
          }
          setSelectionSaving(false);
        }
      });
  }

  async function sync(): Promise<void> {
    if (syncing || selectionSaving || !data) return;
    const now = Date.now();
    const bounds = resolveDateTimeRange(syncRange, now);
    if (
      bounds.from < now - MAX_SYNC_LOOKBACK_DAYS * DAY_MS ||
      bounds.to > now ||
      bounds.from > bounds.to
    ) {
      setError("采集范围须在最近 35 天内，请重新选择。");
      return;
    }
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
        schemaVersion: 2,
        type: "SYNC_REQUEST",
        requestId: crypto.randomUUID(),
        force: true,
        since: Math.max(0, bounds.from),
        until: bounds.to,
        accountIds: selectedAccounts.map((account) => account.accountId),
      });
      if (!response.ok || response.type !== "SYNC_RESULT") {
        throw new Error(
          response.ok ? "同步响应格式错误" : response.error.message,
        );
      }
      setData(response.result.data);
      savedData.current = response.result.data;
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
    const timer = window.setInterval(
      () => setTimeFilterNow(Date.now()),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 1_400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const visible = useMemo(() => {
    if (!data) return [];
    const bounds = resolveDateTimeRange(
      timeRange,
      Math.max(timeFilterNow, Date.now()),
    );
    const filtered = data.submissions.filter((item) => {
      return (
        (source === "all" || item.source === source) &&
        (verdict === "all" ||
          (verdict === "accepted"
            ? item.verdict.code === "accepted"
            : item.verdict.code !== "accepted")) &&
        item.submittedAt >= bounds.from &&
        item.submittedAt <= bounds.to
      );
    });
    return submissionFilter === "latest"
      ? latestSubmissionsPerProblem(filtered)
      : filtered;
  }, [data, timeRange, timeFilterNow, source, submissionFilter, verdict]);
  const lastSuccessfulSyncAt = latestSuccessfulSyncAt(data, selectedAccountIds);
  const hasSyncAccounts = data?.accounts.some(
    (account) =>
      account.enabled && selectedAccountIds.includes(account.accountId),
  );
  const syncNow = Math.max(timeFilterNow, Date.now());
  const syncBounds = resolveDateTimeRange(syncRange, syncNow);
  const syncRangeValid =
    syncBounds.from >= syncNow - MAX_SYNC_LOOKBACK_DAYS * DAY_MS &&
    syncBounds.to <= syncNow &&
    syncBounds.from <= syncBounds.to;

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
            <DateTimeRangePicker
              value={timeRange}
              onChange={setTimeRange}
              additionalPresets={[
                { label: "最近一年", preset: 365 },
                { label: "全部本地记录", preset: 36500 },
              ]}
            />
            <AnimatedSelect
              label="状态筛选"
              value={verdict}
              onChange={setVerdict}
              options={verdictFilterOptions}
            />
            <AnimatedSelect
              label="提交筛选"
              value={submissionFilter}
              onChange={setSubmissionFilter}
              options={submissionFilterOptions}
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
              onSelectionChange={saveSelection}
            />
            <DateTimeRangePicker
              value={syncRange}
              onChange={saveRange}
              ariaLabel="选择采集范围"
              className="sync-option-button"
              align="end"
              maxLookbackDays={MAX_SYNC_LOOKBACK_DAYS}
              disableFuture
              disabled={!data || syncing || selectionSaving}
            />
            <button
              className="quiet-action sync-button"
              type="button"
              onClick={() => void sync()}
              disabled={
                syncing ||
                selectionSaving ||
                !hasSyncAccounts ||
                !syncRangeValid
              }
              title={
                !hasSyncAccounts
                  ? "请至少选择一个可用账号"
                  : !syncRangeValid
                    ? "采集范围须在最近 35 天内，请重新选择"
                    : "同步已选择的账号"
              }
              aria-busy={syncing}
            >
              <span aria-hidden="true" className="action-icon">
                {syncing ? <span className="sync-spinner" /> : "↻"}
              </span>
              同步
            </button>
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
              {items.map((item) => (
                <TimelineRow
                  key={`${item.source}:${item.accountId}:${item.submissionId}`}
                  item={item}
                  data={data}
                  onCopied={() => setToast("已复制")}
                />
              ))}
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
