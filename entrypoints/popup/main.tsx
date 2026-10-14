import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  return "复制题目 Markdown";
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
  const [exporting, setExporting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const sequence = useRef(0);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null)
        window.clearTimeout(copiedTimer.current);
    };
  }, []);

  useEffect(() => {
    const current = ++sequence.current;
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

  async function exportPdf(): Promise<void> {
    if (exporting || copying || state.type !== "supported") return;
    setExporting(true);
    setCopyError(null);
    try {
      await allowCodeforcesStatementImages(
        inspectedTab?.url ?? state.preview.originalUrl,
      );
      await withTimeout(
        startProblemExport(inspectedTab ?? undefined),
        POPUP_ACTION_TIMEOUT_MS,
        "导出任务启动超时，请稍后重试。",
      );
      window.close();
    } catch (error) {
      setState({ type: "error", message: errorText(error) });
      setExporting(false);
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
                className="primary-action"
                disabled={exporting || copying}
                aria-busy={exporting}
                onClick={() => void exportPdf()}
              >
                {exporting ? "准备导出…" : "导出题面 PDF"}
              </button>
              <button
                type="button"
                className={
                  copied
                    ? "copy-markdown-action is-copied"
                    : "copy-markdown-action"
                }
                disabled={exporting || copying}
                aria-busy={copying}
                onClick={() => void copyProblem()}
              >
                {copyButtonLabel(copying, copied)}
              </button>
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
