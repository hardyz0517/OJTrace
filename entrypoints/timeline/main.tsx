import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RuntimeResponse } from "../../src/application/messaging/messages";
import type { StoredData, Submission } from "../../src/domain";
import { isAllowedNavigation } from "../../src/platform/permissions/hosts";
import "./style.css";

const sourceLabels: Record<Submission["source"], string> = {
  codeforces: "Codeforces",
  luogu: "Luogu",
  qoj: "QOJ",
  loj: "LibreOJ",
};

function request<T extends RuntimeResponse>(message: object): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function dateKey(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function verdictLabel(submission: Submission): string {
  const labels: Record<Submission["verdict"]["code"], string> = {
    accepted: "AC",
    wrong_answer: "WA",
    compilation_error: "CE",
    runtime_error: "RE",
    time_limit: "TLE",
    memory_limit: "MLE",
    pending: "Pending",
    partial: "Partial",
    rejected: "Rejected",
    skipped: "Skipped",
    other: submission.verdict.raw,
  };
  return labels[submission.verdict.code];
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
  return candidate && isAllowedNavigation(item.source, candidate)
    ? candidate
    : undefined;
}

function App() {
  const [data, setData] = useState<StoredData | null>(null);
  const [source, setSource] = useState<Submission["source"] | "all">("all");
  const [days, setDays] = useState(30);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const response = await request<Extract<RuntimeResponse, { type: "STATE" }>>(
      {
        schemaVersion: 1,
        type: "GET_STATE",
        requestId: crypto.randomUUID(),
      },
    );
    if (response.ok) setData(response.data);
  }

  async function sync(force: boolean): Promise<void> {
    setSyncing(true);
    setError(null);
    try {
      const response = await request<RuntimeResponse>({
        schemaVersion: 1,
        type: "SYNC_REQUEST",
        requestId: crypto.randomUUID(),
        force,
      });
      if (!response.ok || response.type !== "SYNC_RESULT") {
        throw new Error(
          response.ok ? "同步响应格式错误" : response.error.message,
        );
      }
      setData(response.result.data);
      const failed = response.result.sources.filter((item) => item.error);
      if (failed.length > 0)
        setError(`${failed.length} 个来源暂时不可用，已保留本地缓存。`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void load().then(() => sync(false));
  }, []);

  const visible = useMemo(() => {
    if (!data) return [];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1_000;
    return data.submissions.filter((item) => {
      return (
        (source === "all" || item.source === source) &&
        item.submittedAt >= cutoff
      );
    });
  }, [data, days, source]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">OJTrace</p>
          <h1>题迹</h1>
        </div>
        <div className="actions">
          <a
            className="settings-link"
            href={browser.runtime.getURL("/settings.html")}
          >
            设置
          </a>
          <button
            type="button"
            onClick={() => void sync(true)}
            disabled={syncing}
          >
            {syncing ? "同步中…" : "手动同步"}
          </button>
        </div>
      </header>

      <section className="filters" aria-label="筛选">
        <label>
          OJ
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as typeof source)}
          >
            <option value="all">全部</option>
            {Object.entries(sourceLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          时间
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>最近 7 天</option>
            <option value={30}>最近 30 天</option>
            <option value={365}>最近一年</option>
            <option value={36500}>全部本地记录</option>
          </select>
        </label>
      </section>

      {error && <p className="notice">{error}</p>}

      {!data && <p className="empty">正在读取本地数据…</p>}
      {data && visible.length === 0 && (
        <p className="empty">暂无提交记录。请先在设置中添加账号。</p>
      )}
      <section className="timeline">
        {groupByDate(visible).map(([day, items]) => (
          <section className="day" key={day}>
            <h2>{day}</h2>
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
                  <span className="source">{sourceLabels[item.source]}</span>
                  <span className="problem">
                    {item.problemId}
                    {item.problemName ? ` ${item.problemName}` : ""}
                  </span>
                  <span className={`verdict verdict-${item.verdict.code}`}>
                    {verdictLabel(item)}
                  </span>
                </a>
              ) : (
                <div
                  className="row row-disabled"
                  key={`${item.source}:${item.accountId}:${item.submissionId}`}
                >
                  <time>{formatTime(item.submittedAt)}</time>
                  <span className="source">{sourceLabels[item.source]}</span>
                  <span className="problem">{item.problemId}</span>
                  <span className="verdict verdict-other">链接不可用</span>
                </div>
              ),
            )}
          </section>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
