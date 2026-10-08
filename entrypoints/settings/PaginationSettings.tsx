import { useEffect, useRef, useState, type FormEvent } from "react";
import { RotateCcw, Save } from "lucide-react";
import { adapters } from "../../src/adapters";
import {
  PAGINATION_LIMITS,
  isPaginationPolicy,
  maxPaginationJitterMs,
  resolvePaginationPolicy,
  type PaginationPolicy,
  type Preferences,
  type SourceId,
} from "../../src/domain";
import type { PublicStoredData } from "../../src/application/accounts/account-queries";
import type {
  RuntimeMessage,
  RuntimeResponse,
} from "../../src/application/messaging/messages";
import { OJName } from "../shared/OJName";

function secondsToMs(value: string): number {
  if (!value.trim()) return NaN;
  const seconds = Number(value);
  const milliseconds = seconds * 1_000;
  const rounded = Math.round(milliseconds);
  // Correct floating-point noise without rounding extra precision into a valid step.
  return rounded / 1_000 === seconds ? rounded : milliseconds;
}

type PaginationField = keyof PaginationPolicy;
type PaginationValidation = Partial<Record<PaginationField, string>>;

function inputError(
  value: string,
  milliseconds: number,
  label: string,
  minimum: number,
  maximum: number,
): string | undefined {
  if (!value.trim()) return `请输入${label}。`;
  if (!Number.isFinite(milliseconds)) return `请输入有效的${label}。`;
  if (milliseconds < minimum) return `${label}不能小于 ${minimum / 1_000} 秒。`;
  if (milliseconds > maximum) return `${label}不能超过 ${maximum / 1_000} 秒。`;
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds % PAGINATION_LIMITS.stepMs !== 0
  )
    return `${label}须以 ${PAGINATION_LIMITS.stepMs / 1_000} 秒递增。`;
  return undefined;
}

function validateDraft(
  candidate: PaginationPolicy,
  interval: string,
  jitter: string,
): PaginationValidation {
  const validation: PaginationValidation = {
    intervalMs: inputError(
      interval,
      candidate.intervalMs,
      "基础间隔",
      PAGINATION_LIMITS.minIntervalMs,
      PAGINATION_LIMITS.maxIntervalMs,
    ),
    jitterMs: inputError(
      jitter,
      candidate.jitterMs,
      "随机浮动",
      0,
      PAGINATION_LIMITS.maxIntervalMs,
    ),
  };
  if (
    !validation.intervalMs &&
    !validation.jitterMs &&
    candidate.jitterMs > maxPaginationJitterMs(candidate.intervalMs)
  ) {
    validation.jitterMs = `当前基础间隔下，随机浮动不能超过 ${maxPaginationJitterMs(candidate.intervalMs) / 1_000} 秒，需保留至少 ${PAGINATION_LIMITS.minDelayMs / 1_000} 秒的间隔。`;
  }
  return validation;
}

function PaginationSourceRow({
  source,
  name,
  preferences,
  onUpdated,
}: {
  source: SourceId;
  name: string;
  preferences: Preferences;
  onUpdated: (data: PublicStoredData) => void | Promise<void>;
}) {
  const saved = resolvePaginationPolicy(source, preferences.paginationBySource);
  const overridden = preferences.paginationBySource?.[source] !== undefined;
  const [interval, setInterval] = useState(String(saved.intervalMs / 1_000));
  const [jitter, setJitter] = useState(String(saved.jitterMs / 1_000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<PaginationValidation>({});
  const [saveVersion, setSaveVersion] = useState(0);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    setInterval(String(saved.intervalMs / 1_000));
    setJitter(String(saved.jitterMs / 1_000));
    setValidation({});
  }, [saved.intervalMs, saved.jitterMs, saveVersion]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const candidate = {
    intervalMs: secondsToMs(interval),
    jitterMs: secondsToMs(jitter),
  };
  const valid = isPaginationPolicy(candidate);
  const changed =
    candidate.intervalMs !== saved.intervalMs ||
    candidate.jitterMs !== saved.jitterMs;
  const maxJitter = Number.isFinite(candidate.intervalMs)
    ? maxPaginationJitterMs(candidate.intervalMs)
    : PAGINATION_LIMITS.maxIntervalMs;
  const feedbackId = `pagination-${source}-feedback`;

  function validateOnBlur(): void {
    setValidation(validateDraft(candidate, interval, jitter));
  }

  async function save(policy: PaginationPolicy | null): Promise<void> {
    if (submitting.current) return;
    if (policy !== null && !isPaginationPolicy(policy)) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const command: RuntimeMessage = {
      schemaVersion: 2,
      type: "UPDATE_PAGINATION_POLICY",
      requestId: crypto.randomUUID(),
      source,
      policy,
    };
    try {
      const response = (await browser.runtime.sendMessage(
        command,
      )) as RuntimeResponse;
      if (!response.ok) throw new Error(response.error.message);
      if (response.type !== "UPDATED") throw new Error("保存失败，请重试。");
      if (!mounted.current) return;
      // Refresh authoritative state before resetting the draft. A delayed write
      // reply may predate another tab's update or a clear-all operation.
      await onUpdated(response.data);
      if (!mounted.current) return;
      setSaveVersion((version) => version + 1);
    } catch (error) {
      if (!mounted.current) return;
      setError(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (valid && changed) void save(candidate);
  }

  return (
    <form
      className="pagination-row"
      aria-label={`${name} 采集节奏`}
      onSubmit={submit}
      noValidate
    >
      <div className="pagination-source">
        <OJName source={source} size="small">
          {name}
        </OJName>
      </div>
      <fieldset className="pagination-fields" disabled={busy}>
        <label>
          <span>基础间隔（秒）</span>
          <input
            type="number"
            min={PAGINATION_LIMITS.minIntervalMs / 1_000}
            max={PAGINATION_LIMITS.maxIntervalMs / 1_000}
            step={PAGINATION_LIMITS.stepMs / 1_000}
            value={interval}
            aria-label={`${name} 基础间隔（秒）`}
            aria-invalid={Boolean(validation.intervalMs)}
            aria-describedby={
              validation.intervalMs ? `${feedbackId}-intervalMs` : undefined
            }
            onFocus={() => setValidation({})}
            onBlur={validateOnBlur}
            onChange={(event) => {
              setInterval(event.target.value);
              setValidation({});
              setError(null);
            }}
          />
        </label>
        <label>
          <span>随机浮动（±秒）</span>
          <input
            type="number"
            min={0}
            max={maxJitter / 1_000}
            step={PAGINATION_LIMITS.stepMs / 1_000}
            value={jitter}
            aria-label={`${name} 随机浮动（±秒）`}
            aria-invalid={Boolean(validation.jitterMs)}
            aria-describedby={
              validation.jitterMs ? `${feedbackId}-jitterMs` : undefined
            }
            onFocus={() => setValidation({})}
            onBlur={validateOnBlur}
            onChange={(event) => {
              setJitter(event.target.value);
              setValidation({});
              setError(null);
            }}
          />
        </label>
        <div className="pagination-actions">
          <button
            className="secondary-button pagination-icon-button"
            type="button"
            aria-label="恢复默认"
            title="恢复默认"
            disabled={!overridden && !changed}
            onClick={() => void save(null)}
          >
            <RotateCcw size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button
            className="primary-button pagination-icon-button"
            type="submit"
            aria-label="保存"
            title={busy ? "保存中…" : "保存"}
            aria-busy={busy}
            disabled={!valid || !changed}
          >
            <Save size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </fieldset>
      {(["intervalMs", "jitterMs"] as const).map(
        (field) =>
          validation[field] && (
            <p
              key={field}
              id={`${feedbackId}-${field}`}
              className="pagination-feedback is-error"
              role="alert"
            >
              {validation[field]}
            </p>
          ),
      )}
      {error && (
        <p
          id={feedbackId}
          className="pagination-feedback is-error"
          role="alert"
        >
          {error}
        </p>
      )}
    </form>
  );
}

export function PaginationSettings({
  preferences,
  onUpdated,
}: {
  preferences: Preferences;
  onUpdated: (data: PublicStoredData) => void | Promise<void>;
}) {
  return (
    <section className="settings-section pagination-section">
      <div className="section-heading">
        <h2>采集</h2>
      </div>
      <p className="muted pagination-description">
        为每个 OJ 设置列表分页的基础间隔和随机浮动，基础间隔上限 600
        秒，浮动不可超过基础间隔。保存后从下次同步生效。
        <br />
        同一网站的多个账号和域共享请求队列，网站限流会触发冷却。
      </p>
      <div className="pagination-rows">
        {adapters.map(({ metadata }) => (
          <PaginationSourceRow
            key={metadata.id}
            source={metadata.id}
            name={metadata.displayName}
            preferences={preferences}
            onUpdated={onUpdated}
          />
        ))}
      </div>
    </section>
  );
}
