import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ExternalLink, RefreshCw, Trophy } from "lucide-react";
import type {
  Contest,
  ContestCache,
  ContestEvaluationInfo,
  ContestPhaseFilter,
  ContestPlatform,
  ContestRefreshResult,
} from "../../src/features/contest-schedule";
import {
  buildContestSections,
  CONTEST_DATA_VERSION,
  CONTEST_PLATFORMS,
  endTimeOf,
  formatContestDateTime,
  groupContestSectionByDate,
} from "../../src/features/contest-schedule";
import {
  createRuntimeMessage,
  sendRuntimeMessage,
} from "../shared/runtime-client";
import { AnimatedSelect } from "../shared/AnimatedSelect";
import { OJName } from "../shared/OJName";
import { AppHeader } from "../shared/AppHeader";
import "./style.css";

const platformLabels: Record<ContestPlatform, string> = {
  luogu: "洛谷",
  codeforces: "Codeforces",
  atcoder: "AtCoder",
};

const phaseLabels: Record<Exclude<ContestPhaseFilter, "all">, string> = {
  upcoming: "即将开始",
  running: "进行中",
  finished: "已结束",
  unknown: "时间不完整",
};

const sectionLabels = {
  running: "正在进行",
  upcoming: "即将开始",
  finished: "最近结束",
} as const;

type ContestResponse = Extract<
  Awaited<ReturnType<typeof sendRuntimeMessage>>,
  { ok: true; type: "CONTEST_STATE" }
>;

function formatDate(timestamp: number): string {
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(timestamp);
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
  }).format(timestamp);
  return `${date}（${weekday}）`;
}

function statusText(contest: Contest): string {
  return contest.phase === "unknown"
    ? "时间信息不完整"
    : phaseLabels[contest.phase];
}

function evaluationBadge(evaluation: ContestEvaluationInfo | undefined) {
  if (!evaluation || (!evaluation.rating && !evaluation.estimate)) return null;
  const label =
    evaluation.rating && evaluation.estimate
      ? "参与等级分评定及估值评定"
      : evaluation.estimate
        ? "参与估值评定"
        : "参与等级分评定";
  const tone = evaluation.estimate ? "gold" : "green";
  return (
    <span
      className={`contest-evaluation contest-evaluation-${tone}`}
      title={label}
      aria-label={label}
    >
      <Trophy aria-hidden="true" size={14} />
    </span>
  );
}

function lastUpdated(
  caches: Partial<Record<ContestPlatform, ContestCache>>,
): number | undefined {
  return Object.values(caches)
    .map((cache) => cache?.lastSuccessAt)
    .filter((value): value is number => Number.isFinite(value))
    .sort((a, b) => b - a)[0];
}

function formatUpdated(timestamp: number | undefined): string {
  return timestamp
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(timestamp)
    : "暂无";
}

const optionalContestOrigins = [
  "https://codeforces.com/*",
  "https://atcoder.jp/*",
  "https://kenkoooo.com/*",
];

const contestOriginByPlatform: Partial<Record<ContestPlatform, string>> = {
  codeforces: optionalContestOrigins[0],
  atcoder: optionalContestOrigins[1],
};

function ContestItem({ contest, now }: { contest: Contest; now: number }) {
  const endTime = endTimeOf(contest);
  return (
    <a
      className={`contest-item contest-${contest.phase}${contest.phase === "upcoming" && contest.startTime - now <= 24 * 60 * 60 * 1_000 ? " contest-soon" : ""}`}
      href={contest.url}
      target="_blank"
      rel="noreferrer"
    >
      <div className="contest-item-main">
        <div className="contest-source">
          <OJName source={contest.platform} size="tiny">
            {platformLabels[contest.platform]}
          </OJName>
          {contest.ratedRange && (
            <span className="contest-rated">Rated {contest.ratedRange}</span>
          )}
        </div>
        <strong className="contest-title">
          {contest.title}
          {evaluationBadge(contest.evaluation)}
          <ExternalLink
            aria-hidden="true"
            size={12}
            className="contest-title-link"
          />
        </strong>
        <span className="contest-meta">
          {formatContestDateTime(contest.startTime)} ~{" "}
          {endTime ? formatContestDateTime(endTime) : "时间信息不完整"}
          {contest.problemCount !== undefined &&
            ` · ${contest.problemCount} 题`}
        </span>
      </div>
      <span className={`contest-status status-${contest.phase}`}>
        {statusText(contest)}
      </span>
    </a>
  );
}

export function App() {
  const [caches, setCaches] = useState<
    Partial<Record<ContestPlatform, ContestCache>>
  >({});
  const [platform, setPlatform] = useState<ContestPlatform | "all">("all");
  const [phase, setPhase] = useState<ContestPhaseFilter>("all");
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [results, setResults] = useState<ContestRefreshResult[]>([]);
  const [refreshError, setRefreshError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [showFailures, setShowFailures] = useState(false);
  const [clock, setClock] = useState(Date.now);

  const enrichProblemCounts = useCallback(
    async (
      sources: readonly ContestPlatform[] = CONTEST_PLATFORMS,
      force = false,
    ) => {
      try {
        const response = await sendRuntimeMessage(
          createRuntimeMessage({
            type: "CONTEST_ENRICH_COUNTS",
            platforms: [...sources],
            force,
          }),
        );
        if (response.ok && response.type === "CONTEST_STATE")
          setCaches(response.caches);
      } catch {
        // Optional problem counts never affect the primary schedule view.
      }
    },
    [],
  );

  const refresh = useCallback(
    async (
      requestPermissions: boolean,
      sources: readonly ContestPlatform[] = CONTEST_PLATFORMS,
      preserveNotice = false,
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      if (!preserveNotice) {
        setResults([]);
        setRefreshError(undefined);
        setNotice(undefined);
        setShowFailures(false);
      }
      try {
        // Start the optional-host prompt directly from the refresh click stack.
        const permissionRequest = requestPermissions
          ? browser.permissions.request({ origins: optionalContestOrigins })
          : undefined;
        if (permissionRequest) await permissionRequest;
        const granted: ContestPlatform[] = [];
        for (const source of sources) {
          const origin = contestOriginByPlatform[source];
          if (
            !origin ||
            (await browser.permissions.contains({ origins: [origin] }))
          )
            granted.push(source);
        }
        const response = (await sendRuntimeMessage(
          createRuntimeMessage({ type: "CONTEST_REFRESH", platforms: granted }),
        )) as ContestResponse;
        if (response.ok && response.type === "CONTEST_STATE") {
          setCaches(response.caches);
          setNotice(undefined);
          const visibleSources = requestPermissions ? sources : granted;
          const nextResults = (response.results ?? []).filter((item) =>
            visibleSources.includes(item.platform),
          );
          setResults(nextResults);
          const successful = nextResults
            .filter((item) => item.status === "success")
            .map((item) => item.platform);
          if (successful.length > 0)
            void enrichProblemCounts(successful, requestPermissions);
          if (nextResults.some((item) => item.status !== "success"))
            setShowFailures(false);
        }
      } catch (error) {
        setRefreshError(
          error instanceof Error ? error.message : "刷新赛程失败。",
        );
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setClock(Date.now());
      }
    },
    [enrichProblemCounts],
  );

  const loadState = useCallback(async () => {
    const response = await sendRuntimeMessage(
      createRuntimeMessage({ type: "CONTEST_GET_STATE" }),
    );
    if (!response.ok || response.type !== "CONTEST_STATE") return;
    setCaches(response.caches);
    const hasAnyCache = Object.keys(response.caches).length > 0;
    if (hasAnyCache) void enrichProblemCounts(CONTEST_PLATFORMS);
    const staleCachePlatforms = CONTEST_PLATFORMS.filter(
      (source) =>
        response.caches[source] &&
        response.caches[source]!.contestDataVersion !== CONTEST_DATA_VERSION,
    );
    const sourcesToRefresh: readonly ContestPlatform[] = hasAnyCache
      ? [
          ...new Set([
            ...(!response.caches.luogu ? (["luogu"] as const) : []),
            ...staleCachePlatforms,
          ]),
        ]
      : CONTEST_PLATFORMS;
    if (sourcesToRefresh.length > 0) {
      setNotice(
        !hasAnyCache
          ? "还没有缓存，正在获取公开比赛…"
          : response.caches.luogu
            ? "正在更新缓存中的比赛信息…"
            : "洛谷赛程尚未缓存，正在获取公开比赛…",
      );
      void refresh(false, sourcesToRefresh, true);
    }
  }, [enrichProblemCounts, refresh]);

  useEffect(() => {
    void loadState().catch(() =>
      setRefreshError("读取本地赛程缓存失败，请刷新页面重试。"),
    );
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [loadState]);

  const sections = useMemo(
    () =>
      buildContestSections(
        Object.values(caches).flatMap((cache) => cache?.contests ?? []),
        clock,
        { platform, phase },
      ),
    [caches, clock, phase, platform],
  );
  const sectionGroups = useMemo(
    () =>
      sections.map((section) => ({
        ...section,
        groups: groupContestSectionByDate(section.contests, section.key),
      })),
    [sections],
  );
  const updated = lastUpdated(caches);
  const failedResults = results.filter((item) => item.status !== "success");
  const successfulCount = results.length - failedResults.length;
  const hasPartialUpdate = successfulCount > 0 && failedResults.length > 0;
  const hasTotalFailure =
    results.length > 0 && successfulCount === 0 && failedResults.length > 0;

  return (
    <main className="shell contest-page">
      <AppHeader active="contest-schedule" />
      <div className="contest-page-content">
        <section className="filters" aria-label="赛程筛选">
          <div className="filter-controls">
            <AnimatedSelect
              variant="compact"
              portal
              label="OJ 筛选"
              value={platform}
              onChange={setPlatform}
              options={[
                { value: "all" as const, label: "全部 OJ" },
                ...CONTEST_PLATFORMS.map((item) => ({
                  value: item,
                  label: <OJName source={item}>{platformLabels[item]}</OJName>,
                })),
              ]}
            />
            <AnimatedSelect
              variant="compact"
              portal
              label="状态筛选"
              value={phase}
              onChange={setPhase}
              options={[
                { value: "all" as const, label: "全部状态" },
                ...(
                  ["upcoming", "running", "finished", "unknown"] as const
                ).map((item) => ({ value: item, label: phaseLabels[item] })),
              ]}
            />
          </div>
          <div className="filter-actions">
            <span className="sync-state">
              {updated ? `上次更新 ${formatUpdated(updated)}` : "尚未更新"}
            </span>
            {hasPartialUpdate && (
              <button
                className="refresh-summary refresh-summary-partial"
                type="button"
                aria-expanded={showFailures}
                onClick={() => setShowFailures((value) => !value)}
              >
                部分更新 · {showFailures ? "收起" : "查看失败平台"}
              </button>
            )}
            <button
              className="quiet-action sync-button contest-refresh-button"
              type="button"
              onClick={() => void refresh(true)}
              disabled={loading}
              aria-busy={loading}
            >
              <span aria-hidden="true" className="action-icon">
                {loading ? (
                  <span className="sync-spinner" />
                ) : (
                  <RefreshCw size={14} />
                )}
              </span>
              {loading ? "刷新中…" : "刷新赛程"}
            </button>
          </div>
        </section>
        {(hasTotalFailure ||
          refreshError ||
          (showFailures && failedResults.length > 0)) && (
          <div
            className={`refresh-feedback${hasTotalFailure ? " refresh-feedback-failed" : ""}`}
            role="status"
          >
            {refreshError && <p>{refreshError} 已有缓存仍会保留。</p>}
            {hasTotalFailure && <p>本次更新失败，仍显示上次缓存。</p>}
            {showFailures && failedResults.length > 0 && (
              <ul>
                {failedResults.map((item) => (
                  <li key={item.platform}>
                    <strong>{platformLabels[item.platform]}</strong>
                    {item.message ? `：${item.message}` : "：获取失败"}
                  </li>
                ))}
              </ul>
            )}
            {hasTotalFailure && !showFailures && (
              <button type="button" onClick={() => setShowFailures(true)}>
                查看失败平台
              </button>
            )}
          </div>
        )}
        {notice && (
          <p className="contest-notice contest-notice-neutral">{notice}</p>
        )}
        {sectionGroups.length === 0 ? (
          <p className="contest-empty">当前筛选下暂无比赛。</p>
        ) : (
          <div className="contest-agenda">
            {sectionGroups.map((section) => (
              <section
                className={`contest-section section-${section.key}`}
                key={section.key}
              >
                <h2 className="contest-section-title">
                  {sectionLabels[section.key]}
                </h2>
                {section.groups.map((group) => (
                  <section className="contest-day" key={group.key}>
                    <h3>{formatDate(group.date)}</h3>
                    <div className="contest-day-list">
                      {group.contests.map((contest) => (
                        <ContestItem
                          key={`${contest.platform}:${contest.id}`}
                          contest={contest}
                          now={clock}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
