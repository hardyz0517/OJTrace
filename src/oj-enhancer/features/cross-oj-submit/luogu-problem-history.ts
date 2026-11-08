import type { ProblemHistoryStatus } from "./model";

export const LUOGU_ACCEPTED_STATUS_COLOR = "#52c41a";
export const LUOGU_UNACCEPTED_STATUS_COLOR = "#e74c3c";

export interface LuoguProblemHistoryQueryResult {
  status: ProblemHistoryStatus;
  message?: string;
}

export type LuoguProblemHistoryStatus =
  LuoguProblemHistoryQueryResult | { status: "loading"; message?: string };

function isLuoguProblemHistoryRow(element: Element): boolean {
  return (
    element.matches(".l-flex-info-row") &&
    Array.from(element.children).some(
      (child) => (child.textContent ?? "").trim() === "历史分数",
    )
  );
}

function historyRowForNode(node: Node): Element | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return undefined;
  const containingRow = element.closest(".l-flex-info-row");
  if (containingRow && isLuoguProblemHistoryRow(containingRow))
    return containingRow;
  if (isLuoguProblemHistoryRow(element)) return element;
  return Array.from(element.querySelectorAll(".l-flex-info-row")).find(
    isLuoguProblemHistoryRow,
  );
}

function historyValueInRow(row: Element): HTMLElement | undefined {
  const label = Array.from(row.children).find(
    (child) => (child.textContent ?? "").trim() === "历史分数",
  );
  const link = Array.from(row.children).find(
    (child) => child !== label && child.matches("a"),
  );
  const value = link?.querySelector("span") ?? link;
  return value instanceof HTMLElement ? value : undefined;
}

const originalValues = new WeakMap<
  HTMLElement,
  { text: string; title: string; color: string }
>();

export function renderLuoguProblemHistoryStatus(
  status: LuoguProblemHistoryStatus | undefined,
  root: ParentNode = document,
): boolean {
  const row = Array.from(root.querySelectorAll(".l-flex-info-row")).find(
    isLuoguProblemHistoryRow,
  );
  if (!row) return false;
  const value = historyValueInRow(row);
  if (!value) return false;

  if (!status) {
    const original = originalValues.get(value);
    if (!original) return false;
    if (value.textContent !== original.text) value.textContent = original.text;
    if (value.title !== original.title) value.title = original.title;
    if (value.style.color !== original.color)
      value.style.color = original.color;
    originalValues.delete(value);
    return true;
  }

  if (!originalValues.has(value))
    originalValues.set(value, {
      text: value.textContent ?? "",
      title: value.title,
      color: value.style.color,
    });

  const labels: Record<LuoguProblemHistoryStatus["status"], string> = {
    accepted: "Accepted",
    unaccepted: "Unaccepted",
    none: "暂无",
    unavailable: "无法查询",
    loading: "查询中…",
  };
  const label = labels[status.status];
  if (value.textContent !== label) value.textContent = label;

  const statusColor =
    status.status === "accepted"
      ? LUOGU_ACCEPTED_STATUS_COLOR
      : status.status === "unaccepted"
        ? LUOGU_UNACCEPTED_STATUS_COLOR
        : "";
  if (value.style.color !== statusColor) value.style.color = statusColor;

  const title = status.message ?? "";
  if (value.title !== title) value.title = title;
  return true;
}

export function observeLuoguProblemHistoryChanges(
  onChange: () => void,
  root: Node = document,
): { disconnect(): void } {
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) =>
        [record.target, ...record.addedNodes, ...record.removedNodes].some(
          (node) => historyRowForNode(node),
        ),
      )
    )
      onChange();
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return { disconnect: () => observer.disconnect() };
}

/** Route-scoped loader: each newly opened problem gets a fresh request. */
export class LuoguProblemHistoryStatusController {
  private currentKey: string | undefined;
  private currentStatus: LuoguProblemHistoryStatus | undefined;
  private revision = 0;

  constructor(
    private readonly render: (
      status: LuoguProblemHistoryStatus | undefined,
    ) => void,
  ) {}

  sync(
    key: string | undefined,
    request?: () => Promise<LuoguProblemHistoryQueryResult>,
    sourceName = "Codeforces",
  ): void {
    if (key === this.currentKey) {
      this.render(this.currentStatus);
      return;
    }

    this.currentKey = key;
    this.revision += 1;
    const revision = this.revision;
    this.currentStatus = key
      ? { status: "loading", message: `正在查询 ${sourceName} 提交记录…` }
      : undefined;
    this.render(this.currentStatus);
    if (!key || !request) return;

    void request().then(
      (status) => this.finish(key, revision, status),
      (error: unknown) =>
        this.finish(key, revision, {
          status: "unavailable",
          message:
            error instanceof Error
              ? `${sourceName} 查询失败：${error.message.slice(0, 180)}`
              : `${sourceName} 查询失败，请稍后重试。`,
        }),
    );
  }

  private finish(
    key: string,
    revision: number,
    status: LuoguProblemHistoryQueryResult,
  ): void {
    if (this.currentKey !== key || this.revision !== revision) return;
    this.currentStatus = status;
    this.render(status);
  }
}
