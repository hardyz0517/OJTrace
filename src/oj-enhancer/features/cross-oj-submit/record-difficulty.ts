import type { CrossOjResponse } from "./model";
import {
  luoguDifficultyColor,
  normalizeLuoguProblemDifficulty,
  readLuoguProblemDifficultyInPage,
} from "./luogu-page-context";

const FAILURE_RETRY_MS = 60_000;
const MAX_AUTOMATIC_ATTEMPTS = 2;

export function findDifficultyToggle(
  result: HTMLElement,
): HTMLElement | undefined {
  return [...result.querySelectorAll<HTMLElement>("a, button, span")].find(
    (element) =>
      /^(隐藏难度|显示难度)$/.test((element.textContent ?? "").trim()),
  );
}

export function createRecordDifficultyController(options: {
  problemId: string;
  isActive: () => boolean;
  result: () => HTMLElement | undefined;
  rows: () => readonly HTMLElement[];
  request?: () => Promise<CrossOjResponse>;
  onMessage: (message: string | undefined) => void;
}) {
  let disposed = false;
  let result: HTMLElement | undefined;
  let visible: boolean | undefined;
  let difficulty = readLuoguProblemDifficultyInPage(options.problemId);
  let status: "idle" | "loading" | "ready" | "failed" = "idle";
  let attempts = 0;
  let retryAt = 0;
  let retryTimer: number | undefined;
  let inFlight = false;
  let lastMessage: string | undefined;
  const active = () => !disposed && options.isActive();

  function cancelRetry(): void {
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  function sync(): void {
    if (!active()) return;
    const currentResult = options.result();
    if (currentResult !== result) {
      result = currentResult;
      visible = undefined;
    }
    const label =
      currentResult && findDifficultyToggle(currentResult)?.textContent?.trim();
    const nextVisible =
      label === "隐藏难度" ? true : label === "显示难度" ? false : undefined;
    if (visible === false && nextVisible === true && status === "failed")
      attempts = 0;
    if (nextVisible !== undefined) visible = nextVisible;
    if (difficulty === undefined) {
      const embedded = readLuoguProblemDifficultyInPage(options.problemId);
      if (embedded !== undefined) {
        difficulty = embedded;
        status = "ready";
      }
    }
    const color = luoguDifficultyColor(difficulty);
    const value = visible === true && color ? `var(--lfe-color--${color})` : "";
    for (const row of options.rows()) {
      const name = row.querySelector<HTMLElement>(".problem strong");
      if (!name || name.style.color === value) continue;
      if (value) name.style.color = value;
      else name.style.removeProperty("color");
    }

    let message: string | undefined;
    if (visible === true && difficulty === undefined && options.request) {
      if (status === "idle" || status === "loading")
        message = "正在读取题目难度…";
      if (status === "failed")
        message =
          attempts < MAX_AUTOMATIC_ATTEMPTS
            ? "题目难度暂不可用，稍后自动重试。"
            : "题目难度暂不可用，请稍后搜索重试。";
    }
    if (message !== lastMessage) {
      lastMessage = message;
      options.onMessage(message);
    }

    if (difficulty !== undefined || visible !== true) cancelRetry();
    if (!options.request || inFlight) return;
    if (status === "idle") void load();
    else if (
      status === "failed" &&
      difficulty === undefined &&
      visible === true &&
      attempts < MAX_AUTOMATIC_ATTEMPTS &&
      retryTimer === undefined
    ) {
      retryTimer = window.setTimeout(
        () => {
          retryTimer = undefined;
          if (active()) void load();
        },
        Math.max(0, retryAt - Date.now()),
      );
    }
  }

  async function load(): Promise<void> {
    if (!active() || !options.request || inFlight) return;
    if (retryAt > Date.now()) {
      sync();
      return;
    }
    inFlight = true;
    status = "loading";
    attempts += 1;
    sync();
    try {
      const response = await options.request();
      if (!active()) return;
      if (!response.ok) throw new Error("difficulty-unavailable");
      const fetched = normalizeLuoguProblemDifficulty(
        response.problemDifficulty,
      );
      if (fetched !== undefined) difficulty = fetched;
      retryAt =
        fetched === undefined
          ? Math.max(
              Date.now() + 1_000,
              response.problemDifficultyRetryAt ??
                Date.now() + FAILURE_RETRY_MS,
            )
          : 0;
      status = difficulty === undefined ? "failed" : "ready";
    } catch {
      if (!active()) return;
      retryAt = Date.now() + FAILURE_RETRY_MS;
      status = difficulty === undefined ? "failed" : "ready";
    } finally {
      inFlight = false;
      sync();
    }
  }

  return {
    sync,
    accept(response: CrossOjResponse): void {
      const value = normalizeLuoguProblemDifficulty(response.problemDifficulty);
      if (!active() || value === undefined) return;
      if (options.request && difficulty !== undefined) return;
      difficulty = value;
      status = "ready";
      retryAt = 0;
      sync();
    },
    retry(): void {
      if (!active() || inFlight) return;
      attempts = 0;
      cancelRetry();
      void load();
    },
    dispose(): void {
      disposed = true;
      cancelRetry();
    },
  };
}
