import { adapterBySource } from "../../adapters";
import { AdapterFailure } from "../../domain/errors";
import {
  instanceBrandingKey,
  isWithinSyncWindow,
  validateSyncWindow,
} from "../../domain";
import type {
  AccountRecord,
  AdapterError,
  Diagnostic,
  HttpClient,
  InstanceBrandingRecord,
  PaginationRuntime,
  Submission,
  SyncCoverage,
  SyncWindow,
  PartialReason,
  CollectionProgress,
  ProgressObserver,
  ActivityScheduleRecord,
} from "../../domain";
import { reportProgress } from "../../domain/sync-progress";
import { mergeSubmission, submissionKey } from "../../domain/merge";
import { createPaginationRuntime } from "../../platform/network/pagination-throttle";
import type { StoragePort } from "../storage/store";
import { refreshInstanceBranding } from "./instance-branding";
import { finalizeCoverage } from "../../adapters/shared/submission-window";

export type CollectionSkip =
  "freshness" | "busy" | "superseded" | "disabled" | "cancelled";
export interface SyncSourceResult {
  accountId: string;
  source: AccountRecord["source"];
  records: Submission[];
  diagnostics: Diagnostic[];
  instanceBranding?: InstanceBrandingRecord;
  activitySchedules?: ActivityScheduleRecord[];
  coverage?: SyncCoverage;
  error?: AdapterError;
  skipped?: CollectionSkip;
  stale: boolean;
}
export interface AccountCollection {
  /** Invalidated when all submissions/accounts are cleared, even after fetch settles. */
  generation?: number;
  account: AccountRecord;
  window: SyncWindow;
  attemptAt: number;
  result: SyncSourceResult;
}
export interface AccountCollector {
  collect(input: {
    account: AccountRecord;
    window: SyncWindow;
    now: number;
    limit?: number;
    onProgress?: ProgressObserver;
    recheckActivities?: boolean;
  }): Promise<AccountCollection>;
  cancel(accountId: string): void;
  invalidate(accountId: string, revision: number): void;
  cancelAll(): void;
  isCurrent(collection: AccountCollection): boolean;
}
interface Task {
  revision: number;
  key: string;
  controller: AbortController;
  promise: Promise<AccountCollection>;
  latest: CollectionProgress;
  observers: Set<ProgressObserver>;
}
interface Slot {
  running: Task;
  queued?: Task;
}

function observeTask(task: Task, observer?: ProgressObserver): void {
  if (!observer) return;
  task.observers.add(observer);
  reportProgress(observer, { ...task.latest });
}

function publishTask(task: Task, update: Partial<CollectionProgress>): void {
  task.latest = {
    ...task.latest,
    ...Object.fromEntries(
      Object.entries(update).filter(([, value]) => value !== undefined),
    ),
  };
  for (const observer of task.observers) {
    reportProgress(observer, { ...task.latest });
  }
}

export function skippedCollection(
  account: AccountRecord,
  window: SyncWindow,
  now: number,
  skipped: CollectionSkip,
): AccountCollection {
  return {
    account,
    window,
    attemptAt: now,
    result: {
      accountId: account.accountId,
      source: account.source,
      records: [],
      diagnostics: [],
      skipped,
      stale: true,
    },
  };
}

/** Final contract guard shared by collection and the storage transaction. */
export function guardCollection(
  collection: AccountCollection,
): AccountCollection {
  const { result, window, account } = collection;
  const unique = new Map<string, Submission>();
  let violated = Boolean(
    result.coverage &&
    (result.coverage.window.since !== window.since ||
      result.coverage.window.until !== window.until),
  );
  for (const record of result.records) {
    if (
      record.accountId !== account.accountId ||
      record.source !== account.source ||
      (record.providerAccountKey !== undefined &&
        record.providerAccountKey !== account.providerAccountKey) ||
      (account.source === "hydroj" &&
        (record.origin !== account.origin ||
          record.domainId !== account.domainId))
    ) {
      throw new AdapterFailure({
        kind: "auth_required",
        source: account.source,
        stage: "identity",
        messageKey: "account.identityChanged",
        retryable: false,
        userAction: "edit_account",
        requestId: crypto.randomUUID(),
      });
    }
    if (!isWithinSyncWindow(record.submittedAt, window)) {
      violated = true;
      continue;
    }
    const key = submissionKey(record);
    const old = unique.get(key);
    unique.set(key, old ? mergeSubmission(old, record) : record);
  }
  const records = [...unique.values()];
  const coverage =
    result.coverage &&
    finalizeCoverage(
      window,
      result.coverage.pagesFetched,
      records.length,
      violated
        ? {
            status: "partial",
            reasons: [
              ...new Set([
                ...(result.coverage.outcome.status === "partial"
                  ? result.coverage.outcome.reasons
                  : []),
                "invalid-record" as const,
              ]),
            ] as [PartialReason, ...PartialReason[]],
          }
        : result.coverage.outcome,
    );
  return {
    ...collection,
    result: {
      ...result,
      activitySchedules: result.activitySchedules?.filter(
        (item) =>
          account.source === "hydroj" &&
          item.source === "hydroj" &&
          item.origin === account.origin &&
          item.domainId === account.domainId,
      ),
      records,
      coverage,
      stale: Boolean(
        result.error ||
        result.skipped ||
        coverage?.outcome.status !== "complete",
      ),
      diagnostics: violated
        ? [
            ...result.diagnostics,
            {
              source: account.source,
              code: "window-contract-violation",
              severity: "warning",
              messageKey: "sync.windowContractViolation",
              retryable: false,
            },
          ]
        : result.diagnostics,
    },
  };
}

/** One running task and one queued window per account. Locks settle with HTTP/Cookie cleanup. */
export function createAccountCollector(
  storage: StoragePort,
  http: HttpClient,
  options: { pagination?: PaginationRuntime; deadlineMs?: number } = {},
): AccountCollector {
  const slots = new Map<string, Slot>();
  let generation = 0;
  const pagination = options.pagination ?? createPaginationRuntime();
  const deadlineMs = options.deadlineMs ?? 240_000;

  async function execute(
    account: AccountRecord,
    window: SyncWindow,
    now: number,
    limit: number,
    controller: AbortController,
    onProgress: ProgressObserver,
    recheckActivities: boolean,
  ): Promise<AccountCollection> {
    const base = (result: SyncSourceResult): AccountCollection => ({
      account,
      window,
      attemptAt: now,
      result,
    });
    const empty = {
      accountId: account.accountId,
      source: account.source,
      records: [],
      diagnostics: [],
      stale: true,
    };
    const requestId = crypto.randomUUID();
    try {
      controller.signal.throwIfAborted();
      reportProgress(onProgress, { phase: "identity" });
      const data = await storage.load();
      const active = data.accounts.find(
        (item) => item.accountId === account.accountId,
      );
      if (!active || active.credentialRevision !== account.credentialRevision)
        return skippedCollection(account, window, now, "superseded");
      if (!active.enabled)
        return skippedCollection(account, window, now, "disabled");
      controller.signal.throwIfAborted();
      const adapter = adapterBySource.get(account.source);
      if (!adapter)
        throw new AdapterFailure({
          kind: "unsupported",
          source: account.source,
          stage: "request",
          messageKey: "source.unsupported",
          retryable: false,
          requestId,
        });
      const context = {
        account: active,
        credentials: data.credentials.find(
          (item) => item.accountId === active.accountId,
        )?.credentials,
        signal: controller.signal,
        now,
        requestId,
        http,
      };
      const fetched = await adapter.fetchRecent({
        ...context,
        ...window,
        limit,
        pagination,
        onProgress,
        recheckActivities,
        activitySchedules: Object.values(data.activitySchedules).filter(
          (item) =>
            item.source === active.source &&
            item.origin === active.origin &&
            item.domainId === active.domainId,
        ),
      });
      if (
        controller.signal.aborted &&
        controller.signal.reason?.kind !== "deadline"
      )
        return skippedCollection(
          account,
          window,
          now,
          controller.signal.reason?.kind === "superseded"
            ? "superseded"
            : "cancelled",
        );
      if (
        fetched.account.providerAccountKey !== active.providerAccountKey ||
        fetched.account.accountId !== active.accountId ||
        fetched.account.source !== active.source
      )
        throw new AdapterFailure({
          kind: "auth_required",
          source: account.source,
          stage: "identity",
          messageKey: "account.identityChanged",
          retryable: false,
          userAction: "edit_account",
          requestId,
        });
      let diagnostics = fetched.diagnostics;
      let instanceBranding: InstanceBrandingRecord | undefined;
      reportProgress(onProgress, {
        ...(fetched.coverage
          ? { pagesFetched: fetched.coverage.pagesFetched }
          : {}),
        recordsFetched: fetched.records.length,
      });
      if (!controller.signal.aborted) {
        if (adapter.fetchInstanceBranding && active.origin) {
          reportProgress(onProgress, { phase: "branding" });
        }
        const branding = await refreshInstanceBranding(
          adapter,
          context,
          active.origin
            ? data.instanceBranding[
                instanceBrandingKey(
                  active.source,
                  active.origin,
                  active.domainId,
                )
              ]
            : undefined,
        );
        diagnostics = [...diagnostics, ...branding.diagnostics];
        instanceBranding = branding.branding;
      }
      if (
        controller.signal.aborted &&
        controller.signal.reason?.kind !== "deadline"
      )
        return skippedCollection(
          account,
          window,
          now,
          controller.signal.reason?.kind === "superseded"
            ? "superseded"
            : "cancelled",
        );
      return guardCollection(
        base({
          ...empty,
          records: fetched.records,
          diagnostics,
          instanceBranding,
          activitySchedules: fetched.activitySchedules,
          coverage: fetched.coverage,
        }),
      );
    } catch (error) {
      if (
        controller.signal.aborted &&
        controller.signal.reason?.kind !== "deadline"
      )
        return skippedCollection(
          account,
          window,
          now,
          controller.signal.reason?.kind === "superseded"
            ? "superseded"
            : "cancelled",
        );
      const deadline = controller.signal.reason?.kind === "deadline";
      const adapterError: AdapterError =
        error instanceof AdapterFailure
          ? error.error
          : {
              kind: deadline ? "timeout" : "unknown",
              source: account.source,
              stage: "request",
              messageKey: deadline ? "sync.deadline" : "source.unknownError",
              retryable: deadline,
              requestId,
            };
      return base({ ...empty, error: adapterError });
    }
  }

  return {
    collect({
      account,
      window: requested,
      now,
      limit = 1_000,
      onProgress,
      recheckActivities = false,
    }) {
      const window = validateSyncWindow(requested, now);
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new RangeError("Collection limit must be a positive integer");
      const boundedLimit = Math.min(1_000, Math.max(1, Math.floor(limit)));
      const key = `${generation}:${account.credentialRevision}:${window.since}:${window.until}:${boundedLimit}:${recheckActivities}`;
      const slot = slots.get(account.accountId);
      if (slot) {
        if (slot.queued?.controller.signal.aborted) slot.queued = undefined;
        const newestRevision = Math.max(
          slot.running.revision,
          slot.queued?.revision ?? 0,
        );
        if (account.credentialRevision < newestRevision)
          return Promise.resolve(
            skippedCollection(account, window, now, "superseded"),
          );
        if (account.credentialRevision > newestRevision) {
          slot.running.controller.abort({ kind: "superseded" });
          slot.queued?.controller.abort({ kind: "superseded" });
          slot.queued = undefined;
        } else {
          if (
            slot.running.key === key &&
            !slot.running.controller.signal.aborted
          ) {
            observeTask(slot.running, onProgress);
            return slot.running.promise;
          }
          if (slot.queued?.key === key) {
            observeTask(slot.queued, onProgress);
            return slot.queued.promise;
          }
          if (slot.queued)
            return Promise.resolve(
              skippedCollection(account, window, now, "busy"),
            );
        }
      }
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort({ kind: "deadline" }),
        deadlineMs,
      );
      const prior = slot?.running.promise;
      const taskGeneration = generation;
      let task!: Task;
      const promise = Promise.resolve()
        .then(async () => {
          if (prior) await prior;
          const currentSlot = slots.get(account.accountId);
          if (currentSlot?.queued === task) {
            currentSlot.running = task;
            currentSlot.queued = undefined;
          }
          return {
            ...(await execute(
              account,
              window,
              now,
              boundedLimit,
              controller,
              (update) => publishTask(task, update),
              recheckActivities,
            )),
            generation: taskGeneration,
          };
        })
        .finally(() => {
          clearTimeout(timer);
          task.observers.clear();
          const currentSlot = slots.get(account.accountId);
          if (currentSlot?.running === task && !currentSlot.queued)
            slots.delete(account.accountId);
        });
      task = {
        revision: account.credentialRevision,
        key,
        controller,
        promise,
        latest: { phase: "queued", pagesFetched: 0, recordsFetched: 0 },
        observers: new Set(),
      };
      if (slot) slot.queued = task;
      else slots.set(account.accountId, { running: task });
      observeTask(task, onProgress);
      return task.promise;
    },
    cancel(accountId) {
      const slot = slots.get(accountId);
      slot?.running.controller.abort({ kind: "cancelled" });
      slot?.queued?.controller.abort({ kind: "cancelled" });
    },
    invalidate(accountId, revision) {
      const slot = slots.get(accountId);
      if (slot && slot.running.revision < revision)
        slot.running.controller.abort({ kind: "superseded" });
      if (slot?.queued && slot.queued.revision < revision)
        slot.queued.controller.abort({ kind: "superseded" });
    },
    cancelAll() {
      generation += 1;
      for (const slot of slots.values()) {
        slot.running.controller.abort({ kind: "cancelled" });
        slot.queued?.controller.abort({ kind: "cancelled" });
        slot.queued = undefined;
      }
    },
    isCurrent(collection) {
      return (
        collection.generation === undefined ||
        collection.generation === generation
      );
    },
  };
}

const defaultCollectors = new WeakMap<StoragePort, AccountCollector>();
export function accountCollectorFor(
  storage: StoragePort,
  http: HttpClient,
): AccountCollector {
  let collector = defaultCollectors.get(storage);
  if (!collector) {
    collector = createAccountCollector(storage, http);
    defaultCollectors.set(storage, collector);
  }
  return collector;
}
