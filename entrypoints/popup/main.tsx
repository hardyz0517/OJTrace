import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Copy, Pencil } from "lucide-react";
import { sourceDefinitions } from "../../src/sources/definitions";
import {
  type ActiveTabContext,
  inspectActiveProblemPage,
  openSettings,
  openTimeline,
  startProblemExport,
  extractProblemMarkdown,
  ProblemExportClientError,
} from "../../src/application/problem-export/client";
import type { ProblemPreview } from "../../src/problem/domain";
import type { ProblemExportIntent } from "../../src/application/problem-export/messages";
import { DIRECT_PDF_TIMEOUT_MS } from "../../src/application/problem-export/pdf-worker-messages";
import {
  currentActiveTab,
  enableLuoguPageIntegration,
  hasCrossOjPermissions,
  loadCrossOjHistory,
} from "../../src/oj-enhancer/features/cross-oj-submit/client";
import { parseLuoguCodeforcesProblem } from "../../src/oj-enhancer/features/cross-oj-submit/problem";
import {
  isLuoguAtCoderProblemId,
  parseLuoguAtCoderProblem,
} from "../../src/oj-enhancer/features/cross-oj-submit/atcoder";
import type { CrossOjSubmissionRecord } from "../../src/oj-enhancer/features/cross-oj-submit/model";
import "./style.css";

type ViewState =
  | { type: "loading" }
  | { type: "supported"; preview: ProblemPreview }
  | { type: "unsupported" }
  | { type: "error"; message: string };

const POPUP_INSPECTION_TIMEOUT_MS = 15_000;
const POPUP_ACTION_TIMEOUT_MS = 15_000;
const POPUP_COPY_TIMEOUT_MS = 40_000;
const COPIED_RESET_MS = 1_600;

type PageEntryState = "idle" | "enabling" | "enabled" | "error";

async function allowCodeforcesStatementImages(
  pageUrl: string | undefined,
): Promise<void> {
  if (!pageUrl) return;
  try {
    if (!/(^|\.)codeforces\.com$/i.test(new URL(pageUrl).hostname)) return;
  } catch {
    return;
  }
  const permissions =
    typeof browser === "undefined" ? undefined : browser.permissions;
  if (!permissions?.request) return;
  try {
    // Called directly from the export click so Chrome still has the user
    // gesture. Codeforces draws statement figures from espresso.codeforces.com;
    // the page cannot read those bytes, but the extension can after this grant.
    await permissions.request({ origins: ["https://*.codeforces.com/*"] });
  } catch {
    // Export still continues. Images stay as links when access is denied.
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sourceName(preview: ProblemPreview): string {
  const value = preview as ProblemPreview & {
    ojDisplayName?: string;
    sourceDisplayName?: string;
  };
  return (
    value.ojDisplayName ??
    value.sourceDisplayName ??
    sourceDefinitions[preview.oj]?.metadata.displayName ??
    String(preview.oj)
  );
}

async function writePromisedClipboard(text: Promise<string>): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
      return false;
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": text.then(
          (value) => new Blob([value], { type: "text/plain" }),
        ),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function copyMarkdownText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }
}

function copyButtonLabel(copying: boolean, copied: boolean): string {
  if (copying) return "正在复制…";
  if (copied) return "已复制";
  return "复制 Markdown";
}

function errorText(error: unknown): string {
  if (error instanceof ProblemExportClientError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "当前页面识别失败，请稍后重试。";
}

export function App() {
  const [state, setState] = useState<ViewState>({ type: "loading" });
  const [inspectedTab, setInspectedTab] = useState<ActiveTabContext | null>(
    null,
  );
  const [currentPage, setCurrentPage] = useState<{
    tabId: number;
    url: string;
  } | null>(null);
  const [exporting, setExporting] = useState<ProblemExportIntent | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [pageEntryState, setPageEntryState] = useState<PageEntryState>("idle");
  const [pageEntryError, setPageEntryError] = useState<string | null>(null);
  const [crossOjHistory, setCrossOjHistory] = useState<
    CrossOjSubmissionRecord[]
  >([]);
  const sequence = useRef(0);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null)
        window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    void loadCrossOjHistory().then(setCrossOjHistory);
  }, []);

  useEffect(() => {
    const current = ++sequence.current;
    void currentActiveTab()
      .then((tab) => {
        if (current === sequence.current) setCurrentPage(tab);
      })
      .catch(() => {});
    void withTimeout(
      inspectActiveProblemPage(),
      POPUP_INSPECTION_TIMEOUT_MS,
      "当前页面识别超时，请稍后重试。",
    )
      .then(({ tab, preview }) => {
        if (current !== sequence.current) return;
        setInspectedTab(tab);
        setState(
          preview ? { type: "supported", preview } : { type: "unsupported" },
        );
      })
      .catch((error: unknown) => {
        if (current === sequence.current)
          setState({ type: "error", message: errorText(error) });
      });
    return () => {
      sequence.current += 1;
    };
  }, []);

  function crossOjProblem(): {
    tab: { tabId: number; url: string };
    problemId: string;
    target: "codeforces" | "atcoder";
  } | null {
    const tab =
      currentPage ??
      (inspectedTab
        ? { tabId: inspectedTab.tabId, url: inspectedTab.url }
        : null);
    if (!tab) return null;
    let url: URL;
    try {
      url = new URL(tab.url);
    } catch {
      return null;
    }
    if (
      url.origin !== "https://www.luogu.com.cn" ||
      url.username ||
      url.password
    )
      return null;
    const queryIds = url.searchParams.getAll("pid");
    const pathId = /^\/problem\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    if (queryIds.length > 1) return null;
    let pathProblemId: string | undefined;
    try {
      pathProblemId = pathId ? decodeURIComponent(pathId) : undefined;
    } catch {
      return null;
    }
    const problemId = queryIds[0] ?? pathProblemId;
    const problem = problemId
      ? (parseLuoguCodeforcesProblem(problemId) ??
        parseLuoguAtCoderProblem(problemId))
      : undefined;
    const target =
      problem?.oj ??
      (problemId && isLuoguAtCoderProblemId(problemId) ? "atcoder" : undefined);
    if (
      !problemId ||
      (pathProblemId && queryIds[0] && pathProblemId !== queryIds[0]) ||
      !target
    )
      return null;
    return { tab, problemId, target };
  }

  useEffect(() => {
    const current = crossOjProblem();
    if (!current) {
      setPageEntryState("idle");
      return;
    }
    let active = true;
    void hasCrossOjPermissions(current.target).then((granted) => {
      if (active) setPageEntryState(granted ? "enabled" : "idle");
    });
    return () => {
      active = false;
    };
  }, [currentPage, inspectedTab]);

  const [exportWarnings, setExportWarnings] = useState<string[]>([]);

  async function exportPdf(intent: ProblemExportIntent): Promise<void> {
    if (exporting || copying || state.type !== "supported") return;
    setExporting(intent);
    setCopyError(null);
    try {
      await allowCodeforcesStatementImages(
        inspectedTab?.url ?? state.preview.originalUrl,
      );
      const exported = await withTimeout(
        startProblemExport(inspectedTab ?? undefined, intent),
        intent === "download"
          ? DIRECT_PDF_TIMEOUT_MS + POPUP_ACTION_TIMEOUT_MS
          : POPUP_ACTION_TIMEOUT_MS,
        intent === "download"
          ? "PDF 导出超时，请稍后重试。"
          : "导出任务启动超时，请稍后重试。",
      );
      if (exported?.job.warnings?.length) {
        setExportWarnings(exported.job.warnings.map((w) => w.message));
        setExporting(null);
      } else window.close();
    } catch (error) {
      setState({ type: "error", message: errorText(error) });
      setExporting(null);
    }
  }

  async function copyProblem(): Promise<void> {
    if (exporting || copying || state.type !== "supported") return;
    setCopying(true);
    setCopied(false);
    setCopyError(null);
    if (copiedTimer.current !== null) {
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
    let resolveText: (value: string) => void = () => undefined;
    let rejectText: (reason?: unknown) => void = () => undefined;
    const textPromise = new Promise<string>((resolve, reject) => {
      resolveText = resolve;
      rejectText = reject;
    });
    void textPromise.catch(() => undefined);
    const promisedWrite = writePromisedClipboard(textPromise);
    try {
      const { markdown } = await withTimeout(
        extractProblemMarkdown(inspectedTab ?? undefined),
        POPUP_COPY_TIMEOUT_MS,
        "复制题目超时，请稍后重试。",
      );
      resolveText(markdown);
      const copiedToClipboard =
        (await promisedWrite) || (await copyMarkdownText(markdown));
      if (!copiedToClipboard) throw new Error("无法写入剪贴板，请重试。");
      setCopied(true);
      copiedTimer.current = window.setTimeout(() => {
        copiedTimer.current = null;
        setCopied(false);
      }, COPIED_RESET_MS);
    } catch (error) {
      rejectText(error);
      await promisedWrite.catch(() => undefined);
      setCopyError(errorText(error));
    } finally {
      setCopying(false);
    }
  }

  async function enablePageEntry(): Promise<void> {
    if (pageEntryState === "enabling") return;
    const current = crossOjProblem();
    if (!current) return;
    setPageEntryState("enabling");
    setPageEntryError(null);
    try {
      await enableLuoguPageIntegration({
        tabId: current.tab.tabId,
        url: current.tab.url,
        target: current.target,
      });
      setPageEntryState("enabled");
    } catch (error) {
      setPageEntryError(
        error instanceof Error
          ? error.message
          : "无法启用洛谷页面入口，请重试。",
      );
      setPageEntryState("error");
    }
  }

  async function navigate(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      window.close();
    } catch (error) {
      setState({ type: "error", message: errorText(error) });
    }
  }

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <img
          className="popup-logo"
          src="/icons/ojtrace-32.png"
          alt=""
          width={24}
          height={24}
        />
        <strong>OJTrace</strong>
      </header>

      <section className="popup-content" aria-live="polite">
        {exportWarnings.length > 0 && (
          <aside className="popup-structure-warnings" role="status">
            <strong>PDF 已下载，题面结构提示</strong>
            <ul>
              {exportWarnings.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          </aside>
        )}
        {state.type === "loading" && (
          <p className="popup-status">正在识别当前题目页…</p>
        )}
        {state.type === "supported" && (
          <div className="problem-preview">
            <span className="problem-source">{sourceName(state.preview)}</span>
            <h1 className="problem-heading">
              <span className="problem-id">{state.preview.problemId}</span>
              <span className="problem-title">{state.preview.title}</span>
            </h1>
            <div className="problem-actions">
              <button
                type="button"
                className={`primary-action${exporting ? " is-exporting" : ""}`}
                disabled={exporting !== null || copying}
                aria-busy={exporting !== null}
                onClick={() => void exportPdf("download")}
              >
                {exporting ? (
                  <span className="popup-action-spinner" aria-hidden="true" />
                ) : null}
                <span>
                  {exporting === "download"
                    ? "正在生成 PDF…"
                    : exporting === "edit"
                      ? "正在打开编辑器…"
                      : "直接导出 PDF"}
                </span>
              </button>
              <div className="problem-secondary-actions">
                <button
                  type="button"
                  className="problem-secondary-action export-edit-action"
                  disabled={exporting !== null || copying}
                  onClick={() => void exportPdf("edit")}
                >
                  <Pencil size={14} aria-hidden="true" />
                  <span>编辑 / 预览</span>
                </button>
                <button
                  type="button"
                  className={`problem-secondary-action copy-markdown-action${copied ? " is-copied" : ""}`}
                  disabled={exporting !== null || copying}
                  aria-busy={copying}
                  onClick={() => void copyProblem()}
                >
                  <Copy size={14} aria-hidden="true" />
                  <span>{copyButtonLabel(copying, copied)}</span>
                </button>
              </div>
              {copyError ? (
                <p className="copy-markdown-error">{copyError}</p>
              ) : null}
            </div>
          </div>
        )}
        {state.type === "unsupported" && (
          <p className="popup-status">当前页面暂不支持题面导出</p>
        )}
        {state.type === "error" && (
          <p className="popup-status error">{state.message}</p>
        )}
        {crossOjProblem() && pageEntryState !== "enabled" ? (
          <section className="cross-oj-setup" aria-label="洛谷页面按钮设置">
            <p>
              在洛谷题目页启用原生提交按钮旁的{" "}
              {crossOjProblem()?.target === "codeforces"
                ? "Codeforces"
                : "AtCoder"}{" "}
              提交入口（题目 {crossOjProblem()?.problemId}）。
            </p>
            <button
              type="button"
              className="cross-oj-enable"
              disabled={pageEntryState === "enabling"}
              onClick={() => void enablePageEntry()}
            >
              {pageEntryState === "enabling"
                ? "正在启用…"
                : "授权并启用页面入口"}
            </button>
            {pageEntryError ? (
              <p className="cross-oj-error" role="alert">
                {pageEntryError}
              </p>
            ) : null}
          </section>
        ) : null}
        {crossOjHistory.length > 0 ? (
          <section className="cross-oj-history" aria-label="跨 OJ 提交历史">
            <h2>跨 OJ 提交历史</h2>
            <ul>
              {crossOjHistory.slice(0, 4).map((record) => (
                <li key={`${record.oj}:${record.submissionId}`}>
                  <a href={record.detailUrl} target="_blank" rel="noreferrer">
                    {record.oj === "codeforces" ? "Codeforces" : "AtCoder"} ·{" "}
                    {record.problemId} · #{record.submissionId}
                  </a>
                  <span>
                    {record.evaluationStatus === "accepted"
                      ? "Accepted"
                      : record.evaluationStatus === "rejected"
                        ? "已完成（查看详情）"
                        : record.evaluationStatus === "judging"
                          ? "评测中"
                          : "评测状态未知（查看详情）"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>

      <footer className="popup-footer">
        <button
          type="button"
          className="secondary-action"
          onClick={() => void navigate(openTimeline)}
        >
          时间线
        </button>
        <button
          type="button"
          className="secondary-action"
          onClick={() => void navigate(openSettings)}
        >
          设置
        </button>
      </footer>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<App />);
