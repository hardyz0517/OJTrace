import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountConfig, AccountSyncProgress } from "../../src/domain";
import { isSyncProgressEvent } from "../../src/application/messaging/messages";
import type { SyncResult } from "../../src/application/sync/sync-service";

export interface SyncRunProgress {
  requestId: string;
  running: boolean;
  accountConfigs: AccountConfig[];
  accounts: AccountSyncProgress[];
  addedRecords: number;
  interruption?: string;
}

export function useSyncProgress() {
  const [run, setRun] = useState<SyncRunProgress | null>(null);
  const active = useRef<{ requestId: string; disconnect: () => void } | null>(
    null,
  );

  useEffect(
    () => () => {
      active.current?.disconnect();
      active.current = null;
    },
    [],
  );

  function start(accounts: AccountConfig[]): string {
    active.current?.disconnect();
    const requestId = crypto.randomUUID();
    const sequences = new Map<string, number>();
    const listener = (raw: unknown, sender: { id?: string }) => {
      if (
        sender.id !== browser.runtime.id ||
        !isSyncProgressEvent(raw) ||
        raw.requestId !== active.current?.requestId
      )
        return;
      const { progress, sequence } = raw;
      if (sequence <= (sequences.get(progress.accountId) ?? -1)) return;
      sequences.set(progress.accountId, sequence);
      setRun((previous) => {
        if (!previous?.running || previous.requestId !== requestId)
          return previous;
        return {
          ...previous,
          accounts: previous.accounts.map((account) =>
            account.accountId === progress.accountId &&
            account.source === progress.source
              ? progress
              : account,
          ),
        };
      });
    };
    browser.runtime.onMessage.addListener(listener);
    active.current = {
      requestId,
      disconnect: () => browser.runtime.onMessage.removeListener(listener),
    };
    setRun({
      requestId,
      running: true,
      accountConfigs: accounts,
      accounts: accounts.map((account) => ({
        accountId: account.accountId,
        source: account.source,
        phase: "queued",
        status: "running",
        pagesFetched: 0,
        recordsFetched: 0,
      })),
      addedRecords: 0,
    });
    return requestId;
  }

  function disconnect(requestId: string): boolean {
    if (active.current?.requestId !== requestId) return false;
    active.current.disconnect();
    active.current = null;
    return true;
  }

  function finish(
    requestId: string,
    result: Pick<SyncResult, "progress" | "addedRecords">,
  ) {
    if (!disconnect(requestId)) return;
    // The committed result wins over late notifications or optimistic completion.
    setRun((previous) =>
      previous?.requestId === requestId
        ? {
            ...previous,
            running: false,
            addedRecords: result.addedRecords,
            accounts: previous.accounts.map(
              (account) =>
                result.progress.find(
                  (item) =>
                    item.accountId === account.accountId &&
                    item.source === account.source,
                ) ?? {
                  ...account,
                  phase: "done",
                  status: "cancelled",
                  messageKey: "sync.cancelled",
                },
            ),
          }
        : previous,
    );
  }

  function fail(requestId: string, interruption: string) {
    if (!disconnect(requestId)) return;
    setRun((previous) =>
      previous?.requestId === requestId
        ? {
            ...previous,
            running: false,
            interruption,
            accounts: previous.accounts.map((account) => ({
              ...account,
              phase: "done",
              status: account.status === "complete" ? "partial" : "failed",
            })),
          }
        : previous,
    );
  }

  const dismiss = useCallback((requestId: string) => {
    setRun((previous) =>
      previous?.requestId === requestId && !previous.running ? null : previous,
    );
  }, []);

  return { run, start, finish, fail, dismiss };
}
