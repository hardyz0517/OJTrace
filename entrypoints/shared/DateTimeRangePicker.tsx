import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Popover from "@radix-ui/react-popover";
import type { DateRange } from "react-day-picker";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Input } from "./ui/input";
import {
  dateWithTime,
  formatRangeDate,
  formatRangeTime,
  parseRangeDateTime,
  quickDateTimeRange,
  resolveDateTimeRange,
  type DateTimeRange,
  type DateTimeRangePreset,
} from "./date-time-range";
import "./DateTimeRangePicker.css";

export type { DateTimeRange, DateTimeRangePreset } from "./date-time-range";

export interface DateTimeRangePickerProps {
  value: DateTimeRange;
  onChange: (value: DateTimeRange) => void;
  className?: string;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  additionalPresets?: readonly { label: string; preset: DateTimeRangePreset }[];
  ariaLabel?: string;
  maxLookbackDays?: number;
  disableFuture?: boolean;
}

const QUICK_RANGES: { label: string; preset: DateTimeRangePreset }[] = [
  { label: "今天", preset: "today" },
  { label: "1d", preset: 1 },
  { label: "7d", preset: 7 },
  { label: "14d", preset: 14 },
  { label: "30d", preset: 30 },
];

type Endpoint = "from" | "to";
type Fields = Record<Endpoint, { date: string; time: string }>;

function DateInputMenu({
  label,
  value,
  disabled,
  minTimestamp,
  maxTimestamp,
  onSelect,
}: {
  label: string;
  value: number;
  disabled: boolean;
  minTimestamp: number | undefined;
  maxTimestamp: number | undefined;
  onSelect: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(value));
  const selected = new Date(value);
  const today = Date.now();
  const todayDate = formatRangeDate(today);
  const todayAllowed =
    (minTimestamp === undefined ||
      todayDate >= formatRangeDate(minTimestamp)) &&
    (maxTimestamp === undefined || todayDate <= formatRangeDate(maxTimestamp));

  function chooseDate(date: Date | undefined): void {
    onSelect(date ? formatRangeDate(date.getTime()) : "");
    setOpen(false);
  }

  return (
    <Popover.Root
      open={open && !disabled}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setMonth(new Date(value));
        setOpen(nextOpen);
      }}
    >
      <Popover.Trigger asChild>
        <Button
          className="date-range-picker-button date-range-calendar-button"
          aria-label={`选择${label}日期`}
          disabled={disabled}
        >
          <PickerIcon kind="calendar" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="date-range-date-menu"
          aria-label={`${label}日期菜单`}
          sideOffset={6}
          collisionPadding={12}
        >
          <Calendar
            mode="single"
            required
            autoFocus
            month={month}
            onMonthChange={setMonth}
            selected={selected}
            startMonth={
              minTimestamp === undefined ? undefined : new Date(minTimestamp)
            }
            endMonth={
              maxTimestamp === undefined ? undefined : new Date(maxTimestamp)
            }
            disabled={[
              ...(minTimestamp === undefined
                ? []
                : [{ before: new Date(minTimestamp) }]),
              ...(maxTimestamp === undefined
                ? []
                : [{ after: new Date(maxTimestamp) }]),
            ]}
            onSelect={chooseDate}
          />
          <div className="date-range-date-menu-footer">
            <Button onClick={() => chooseDate(undefined)}>清除</Button>
            <Button
              disabled={!todayAllowed}
              onClick={() => chooseDate(new Date(today))}
            >
              今天
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function fieldsFor(value: DateTimeRange): Fields {
  return {
    from: {
      date: formatRangeDate(value.from),
      time: formatRangeTime(value.from),
    },
    to: { date: formatRangeDate(value.to), time: formatRangeTime(value.to) },
  };
}

function calendarRangeFor(value: DateTimeRange): DateRange {
  return { from: new Date(value.from), to: new Date(value.to) };
}

function rangeLabel(value: DateTimeRange): string {
  if (value.preset === 365) return "最近一年";
  if (value.preset === 36500) return "全部本地记录";
  if (value.preset !== undefined) {
    return value.preset === "today" ? "今天" : `最近 ${value.preset} 天`;
  }
  const from = formatRangeDate(value.from).slice(5);
  const to = formatRangeDate(value.to).slice(5);
  return from === to ? `${from} · 自定义` : `${from} – ${to}`;
}

function PickerIcon({ kind }: { kind: "calendar" | "clock" | "check" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {kind === "calendar" ? (
        <>
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
          <path d="M5 2v3M11 2v3M3 7h10M5.5 9.5h.01M8 9.5h.01M10.5 9.5h.01M5.5 11.5h.01M8 11.5h.01" />
        </>
      ) : kind === "clock" ? (
        <>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 4.5V8l2.5 1.5" />
        </>
      ) : (
        <path d="m3.5 8 3 3 6-6" />
      )}
    </svg>
  );
}

export function DateTimeRangePicker({
  value,
  onChange,
  className = "",
  disabled = false,
  align = "start",
  additionalPresets = [],
  ariaLabel = "时间筛选",
  maxLookbackDays,
  disableFuture = false,
}: DateTimeRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now);
  const [draft, setDraft] = useState(value);
  const [fields, setFields] = useState(() => fieldsFor(value));
  const [month, setMonth] = useState(() => new Date(value.to));
  const [calendarRange, setCalendarRange] = useState<DateRange | undefined>(
    () => calendarRangeFor(value),
  );
  const [activeField, setActiveField] = useState<Endpoint>("from");
  const snapshot = useRef(value);
  const quickButton = useRef<HTMLButtonElement>(null);
  const timeInputRefs = useRef<Record<Endpoint, HTMLInputElement | null>>({
    from: null,
    to: null,
  });
  const id = useId();

  function openTimePicker(endpoint: Endpoint): void {
    const input = timeInputRefs.current[endpoint];
    if (!input || input.disabled) return;
    setActiveField(endpoint);
    if (input.showPicker) {
      // Opening a native picker does not require selecting an input segment.
      input.blur();
      input.showPicker();
    } else {
      input.focus({ preventScroll: true });
    }
  }

  function editInput(
    endpoint: Endpoint,
    key: "date" | "time",
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    const input = event.currentTarget;
    editField(
      endpoint,
      key,
      key === "date" ? input.value.replaceAll("-", "/") : input.value,
    );
  }

  function replaceDraft(next: DateTimeRange): void {
    setDraft(next);
    setFields(fieldsFor(next));
    setCalendarRange(calendarRangeFor(next));
  }

  function changeOpen(nextOpen: boolean): void {
    if (nextOpen) {
      snapshot.current = value;
      setClockNow(Date.now());
      const current = resolveDateTimeRange(value);
      replaceDraft(current);
      // Open on the beginning of the range so the selected run starts in view.
      setMonth(new Date(current.from));
      setActiveField("from");
    } else {
      replaceDraft(snapshot.current);
    }
    setOpen(nextOpen);
  }

  useEffect(() => {
    if (
      !open ||
      (!draft.followNow && maxLookbackDays === undefined && !disableFuture)
    )
      return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open, draft.followNow, maxLookbackDays, disableFuture]);

  const minTimestamp =
    maxLookbackDays === undefined
      ? undefined
      : clockNow - maxLookbackDays * 86_400_000;
  const maxTimestamp = disableFuture ? clockNow : undefined;

  function withinBounds(range: DateTimeRange, now = clockNow): boolean {
    return (
      (maxLookbackDays === undefined ||
        range.from >= now - maxLookbackDays * 86_400_000) &&
      (!disableFuture || range.to <= now)
    );
  }

  function boundedTime(timestamp: number): number {
    return Math.min(
      maxTimestamp ?? Infinity,
      Math.max(minTimestamp ?? -Infinity, timestamp),
    );
  }

  const liveDraft = resolveDateTimeRange(draft, clockNow);
  const displayFields = draft.followNow
    ? {
        from:
          draft.preset === undefined ? fields.from : fieldsFor(liveDraft).from,
        to: fieldsFor(liveDraft).to,
      }
    : fields;

  const from = parseRangeDateTime(
    displayFields.from.date,
    displayFields.from.time,
  );
  const to = parseRangeDateTime(displayFields.to.date, displayFields.to.time);
  const invalidEndpoint = from === null || to === null;
  const invalidOrder =
    !invalidEndpoint && (from > to || liveDraft.from > liveDraft.to);
  const outsideBounds = !invalidEndpoint && !withinBounds(liveDraft);
  const error = invalidEndpoint
    ? "请输入有效日期与 HH:mm 时间"
    : invalidOrder
      ? "开始时间不能晚于结束时间"
      : outsideBounds
        ? maxLookbackDays !== undefined && liveDraft.from < minTimestamp!
          ? `最多回溯最近 ${maxLookbackDays} 天`
          : "不能选择未来时间"
        : null;

  function editField(
    endpoint: Endpoint,
    key: "date" | "time",
    text: string,
  ): void {
    const nextFields = {
      ...displayFields,
      [endpoint]: { ...displayFields[endpoint], [key]: text },
    };
    setFields(nextFields);
    const field = nextFields[endpoint];
    const parsed = parseRangeDateTime(field.date, field.time);
    const nextDraft = {
      ...liveDraft,
      ...(parsed === null ? {} : { [endpoint]: parsed }),
      preset: undefined,
      followNow: endpoint === "to" ? false : draft.followNow,
    };
    setDraft(nextDraft);
    if (parsed !== null) {
      setCalendarRange(calendarRangeFor(nextDraft));
      if (key === "date") setMonth(new Date(parsed));
    }
  }

  function chooseDays(_selected: DateRange | undefined, day: Date): void {
    if (activeField === "from") {
      const next = {
        from: boundedTime(dateWithTime(day, liveDraft.from)),
        to: boundedTime(dateWithTime(day, liveDraft.to)),
        followNow: false,
      };
      replaceDraft(next);
      setCalendarRange({ from: day, to: undefined });
      setActiveField("to");
      return;
    }
    const startDay = calendarRange?.from ?? new Date(liveDraft.from);
    const earlier = day < startDay ? day : startDay;
    const later = day < startDay ? startDay : day;
    const next = {
      from: boundedTime(dateWithTime(earlier, liveDraft.from)),
      to: boundedTime(dateWithTime(later, liveDraft.to)),
      followNow: false,
    };
    replaceDraft(next);
    setActiveField("from");
  }

  function chooseQuick(preset: DateTimeRangePreset): void {
    const next = quickDateTimeRange(preset, draft.followNow);
    setClockNow(next.to);
    replaceDraft(next);
    setMonth(new Date(next.from));
    setActiveField("from");
  }

  function changeFollowNow(checked: boolean): void {
    setClockNow(Date.now());
    const current = checked
      ? resolveDateTimeRange({ ...liveDraft, followNow: true })
      : { ...liveDraft, followNow: false };
    setDraft(current);
    setFields((previous) => ({
      from:
        current.preset === undefined ? previous.from : fieldsFor(current).from,
      to: fieldsFor(current).to,
    }));
    setCalendarRange(calendarRangeFor(current));
    setMonth(new Date(current.from));
  }

  function submit(): void {
    if (error) return;
    const next = resolveDateTimeRange(draft);
    if (next.from > next.to || !withinBounds(next, Date.now())) return;
    onChange(next);
    setOpen(false);
  }

  const currentValue = resolveDateTimeRange(value);
  const triggerTitle = `${formatRangeDate(currentValue.from)} ${formatRangeTime(currentValue.from)} – ${formatRangeDate(currentValue.to)} ${formatRangeTime(currentValue.to)}${value.followNow ? " · 结束时间跟随当前时刻" : ""}`;

  return (
    <Popover.Root open={open} onOpenChange={changeOpen}>
      <Popover.Trigger asChild>
        <Button
          className={`date-range-trigger ${className}`.trim()}
          aria-label={ariaLabel}
          title={triggerTitle}
          disabled={disabled}
        >
          <span>{rangeLabel(value)}</span>
          <span className="select-chevron" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal forceMount>
        <Popover.Content
          forceMount
          className="date-range-popover"
          sideOffset={8}
          align={align}
          collisionPadding={12}
          aria-label="选择日期与时间范围"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            quickButton.current?.focus({ preventScroll: true });
          }}
        >
          <div className="date-range-quick" aria-label="快捷范围">
            {QUICK_RANGES.map((quick, index) => (
              <Button
                ref={index === 0 ? quickButton : undefined}
                className="date-range-quick-button"
                key={quick.label}
                aria-pressed={draft.preset === quick.preset}
                onClick={() => chooseQuick(quick.preset)}
              >
                {quick.label}
              </Button>
            ))}
            {additionalPresets.length > 0 && (
              <div className="date-range-additional-presets">
                {additionalPresets.map((quick) => (
                  <Button
                    className="date-range-quick-button date-range-additional-preset"
                    key={quick.preset}
                    aria-pressed={draft.preset === quick.preset}
                    onClick={() => chooseQuick(quick.preset)}
                  >
                    {quick.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="date-range-main">
            <div className="date-range-fields">
              <p
                className={`date-range-caption${error ? " is-error" : ""}`}
                id={`${id}-hint`}
                aria-live="polite"
              >
                {error ?? "支持日期与时间"}
              </p>
              {(["from", "to"] as const).map((endpoint) => {
                const label = endpoint === "from" ? "开始" : "结束";
                const locked = endpoint === "to" && draft.followNow;
                const invalid =
                  endpoint === "from" ? from === null : to === null;
                return (
                  <div
                    className="date-range-field"
                    data-active={activeField === endpoint}
                    data-locked={locked}
                    key={endpoint}
                    role="group"
                    aria-label={`${label}时间`}
                    onFocus={() => setActiveField(endpoint)}
                  >
                    <span className="date-range-field-label">{label}时间</span>
                    <div className="date-range-inputs">
                      <Input
                        className="date-range-date-input"
                        type="date"
                        lang="zh-CN"
                        aria-label={`${label}日期`}
                        aria-invalid={invalid || invalidOrder || outsideBounds}
                        aria-describedby={`${id}-hint`}
                        min={
                          minTimestamp === undefined
                            ? undefined
                            : formatRangeDate(minTimestamp).replaceAll("/", "-")
                        }
                        max={
                          maxTimestamp === undefined
                            ? undefined
                            : formatRangeDate(maxTimestamp).replaceAll("/", "-")
                        }
                        value={displayFields[endpoint].date.replaceAll(
                          "/",
                          "-",
                        )}
                        onChange={(event) => editInput(endpoint, "date", event)}
                        disabled={locked}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <DateInputMenu
                        label={label}
                        value={liveDraft[endpoint]}
                        disabled={locked}
                        minTimestamp={minTimestamp}
                        maxTimestamp={maxTimestamp}
                        onSelect={(date) => editField(endpoint, "date", date)}
                      />
                      <Input
                        ref={(input) => {
                          timeInputRefs.current[endpoint] = input;
                        }}
                        className="date-range-time-input"
                        type="time"
                        step={60}
                        aria-label={`${label}时刻`}
                        min={
                          minTimestamp !== undefined &&
                          displayFields[endpoint].date ===
                            formatRangeDate(minTimestamp)
                            ? formatRangeTime(minTimestamp)
                            : undefined
                        }
                        max={
                          maxTimestamp !== undefined &&
                          displayFields[endpoint].date ===
                            formatRangeDate(maxTimestamp)
                            ? formatRangeTime(maxTimestamp)
                            : undefined
                        }
                        aria-invalid={invalid || invalidOrder || outsideBounds}
                        aria-describedby={`${id}-hint`}
                        value={displayFields[endpoint].time}
                        onChange={(event) => editInput(endpoint, "time", event)}
                        disabled={locked}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <Button
                        className="date-range-picker-button"
                        aria-label={`选择${label}时刻`}
                        onClick={() => openTimePicker(endpoint)}
                        disabled={locked}
                      >
                        <PickerIcon kind="clock" />
                      </Button>
                    </div>
                  </div>
                );
              })}
              <label className="date-range-follow" htmlFor={`${id}-follow`}>
                <Checkbox.Root
                  id={`${id}-follow`}
                  className="date-range-checkbox"
                  checked={draft.followNow}
                  onCheckedChange={(checked) =>
                    changeFollowNow(checked === true)
                  }
                >
                  <Checkbox.Indicator className="date-range-checkbox-icon">
                    <PickerIcon kind="check" />
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <span>结束时间跟随当前时刻</span>
              </label>
              <div className="date-range-footer">
                <Button
                  className="date-range-cancel"
                  onClick={() => changeOpen(false)}
                >
                  取消
                </Button>
                <Button
                  className="date-range-confirm"
                  onClick={submit}
                  disabled={Boolean(error)}
                >
                  确定
                </Button>
              </div>
            </div>
            <div className="date-range-calendar">
              <Calendar
                mode="range"
                required
                month={month}
                onMonthChange={setMonth}
                selected={
                  draft.followNow ? calendarRangeFor(liveDraft) : calendarRange
                }
                disabled={[
                  ...(minTimestamp === undefined
                    ? []
                    : [{ before: new Date(minTimestamp) }]),
                  ...(maxTimestamp === undefined
                    ? []
                    : [{ after: new Date(maxTimestamp) }]),
                ]}
                onSelect={chooseDays}
              />
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
