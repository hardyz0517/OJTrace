import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { ProblemDocument } from "../../src/problem/domain";
import { TypstProblemRenderer } from "../../src/problem/render/typst-renderer";
import { BrowserTypstCompiler } from "../../src/problem/render/browser-typst-compiler";
import { compileDiagnostic } from "../../src/problem/render/compile-diagnostic";
import {
  isProblemExportPortEvent,
  type ProblemExportFallbackJob,
  type ProblemExportPortEvent,
} from "../../src/application/problem-export/messages";
import { createProblemExportConnectMessage } from "../../src/application/problem-export/transport";

type ExportStatus = "connecting" | "extracting" | "ready" | "error";

const EXPORT_TIMEOUT_MS = 90_000;

function tokenFromLocation(): string | undefined {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return hash.get("token") ?? query.get("token") ?? undefined;
}

function fallbackJobFromLocation(
  token: string,
): ProblemExportFallbackJob | undefined {
  const query = new URLSearchParams(window.location.search);
  const tabId = Number(query.get("tabId"));
  const createdAt = Number(query.get("createdAt"));
  const expiresAt = Number(query.get("expiresAt"));
  const expectedUrl = query.get("expectedUrl") ?? "";
  if (
    !Number.isInteger(tabId) ||
    tabId < 0 ||
    !expectedUrl ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= createdAt
  )
    return undefined;
  return { token, tabId, expectedUrl, createdAt, expiresAt };
}

function downloadPdf(bytes: Uint8Array, filename: string): void {
  // Slice to an ArrayBuffer whose byteOffset/length are exact.  This avoids a
  // detached/oversized buffer when a runtime message transfers a view.
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const url = URL.createObjectURL(
    new Blob([buffer], { type: "application/pdf" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function safeFilename(document: ProblemDocument): string {
  const raw = `${document.problemId || "problem"}-${document.title || "statement"}`;
  const value = raw
    .split("")
    .filter(
      (character) => character >= " " && !'\\/:*?"<>|'.includes(character),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${value || "ojtrace-statement"}.pdf`;
}

function isProblemDocument(value: unknown): value is ProblemDocument {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProblemDocument>;
  return (
    typeof item.oj === "string" &&
    typeof item.problemId === "string" &&
    typeof item.title === "string" &&
    typeof item.originalUrl === "string" &&
    Array.isArray(item.blocks) &&
    typeof item.markdown === "string" &&
    Array.isArray(item.assets) &&
    Array.isArray(item.warnings) &&
    item.warnings.every(
      (warning) =>
        Boolean(warning) &&
        typeof warning === "object" &&
        typeof warning.code === "string" &&
        typeof warning.message === "string",
    )
  );
}

function eventError(
  event: Extract<ProblemExportPortEvent, { type: "PROBLEM_EXPORT_ERROR" }>,
): string {
  return typeof event.error === "string" && event.error.trim()
    ? event.error
    : "题面导出失败，请从题目页重新发起。";
}

function ProblemExport(): ReactElement {
  const [status, setStatus] = useState<ExportStatus>("connecting");
  const [message, setMessage] = useState("正在准备题面…");
  const [problem, setProblem] = useState<ProblemDocument | null>(null);
  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(
    null,
  );
  const mountedRef = useRef(false);
  const renderGeneration = useRef(0);
  const compileExpired = useRef(false);
  const exportTimer = useRef<number | undefined>(undefined);

  const renderDocument = useCallback(
    async (document: ProblemDocument, preferredName?: string) => {
      const generation = ++renderGeneration.current;
      setProblem(document);
      const resolvedFilename = preferredName || safeFilename(document);
      setStatus("extracting");
      setMessage("正在生成 A4 PDF…");

      try {
        const renderer = new TypstProblemRenderer(new BrowserTypstCompiler());
        const pdfBytes = await renderer.render(document, {
          filename: resolvedFilename,
        });
        if (
          !mountedRef.current ||
          generation !== renderGeneration.current ||
          compileExpired.current
        )
          return;
        if (!isPdf(pdfBytes)) throw new Error("PDF 数据校验失败");
        downloadPdf(pdfBytes, resolvedFilename);
        if (exportTimer.current !== undefined) {
          window.clearTimeout(exportTimer.current);
          exportTimer.current = undefined;
        }
        setStatus("ready");
        setMessage("PDF 已生成并下载。");
      } catch (error) {
        if (
          !mountedRef.current ||
          generation !== renderGeneration.current ||
          compileExpired.current
        )
          return;
        if (exportTimer.current !== undefined) {
          window.clearTimeout(exportTimer.current);
          exportTimer.current = undefined;
        }
        console.error("[OJTrace] PDF generation failed", error);
        setStatus("error");
        setMessage(compileDiagnostic(error));
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    const token = tokenFromLocation();
    if (!token) {
      setStatus("error");
      setMessage("导出任务已失效，请回到题目页重新发起导出。");
      return () => {
        mountedRef.current = false;
        renderGeneration.current += 1;
      };
    }
    const fallbackJob = fallbackJobFromLocation(token);
    let port: ReturnType<typeof browser.runtime.connect>;
    try {
      port = browser.runtime.connect({ name: "problem-export" });
    } catch {
      setStatus("error");
      setMessage("无法连接后台导出服务，请回到题目页重新发起导出。");
      return () => {
        mountedRef.current = false;
        renderGeneration.current += 1;
      };
    }
    portRef.current = port;
    let documentReceived = false;
    let terminal = false;
    compileExpired.current = false;
    const timeout = window.setTimeout(() => {
      if (!mountedRef.current) return;
      if (documentReceived) {
        compileExpired.current = true;
        renderGeneration.current += 1;
        setStatus("error");
        setMessage("PDF 生成超时，本次没有生成文件。请关闭此页后重试。");
        return;
      }
      if (terminal) return;
      terminal = true;
      setStatus("error");
      setMessage("读取题面超时，请回到题目页重新发起导出。");
      portRef.current = null;
      port.disconnect();
    }, EXPORT_TIMEOUT_MS);
    exportTimer.current = timeout;
    const clearExportTimeout = () => {
      window.clearTimeout(timeout);
      exportTimer.current = undefined;
    };
    const onMessage = (raw: unknown) => {
      if (!mountedRef.current) return;
      if (!isProblemExportPortEvent(raw)) return;
      const event = raw;
      if (event.token !== token || terminal || documentReceived) return;
      if (event.type === "PROBLEM_EXPORT_PROGRESS") {
        setStatus("extracting");
        setMessage(
          event.phase === "capturing" ? "正在读取题面…" : "正在提取题面…",
        );
      } else if (event.type === "PROBLEM_EXPORT_DOCUMENT") {
        if (!isProblemDocument(event.document)) {
          terminal = true;
          clearExportTimeout();
          setStatus("error");
          setMessage("后台返回的题面数据无效，请回到题目页重新发起导出。");
          portRef.current = null;
          port.disconnect();
          return;
        }
        documentReceived = true;
        terminal = true;
        port.onMessage.removeListener(onMessage);
        portRef.current = null;
        // The job has been consumed and the complete document is now local.
        // Release the port before loading/compiling the WASM renderer.
        port.disconnect();
        void renderDocument(event.document);
      } else {
        terminal = true;
        clearExportTimeout();
        const message = eventError(event);
        setStatus("error");
        setMessage(message);
        port.onMessage.removeListener(onMessage);
        portRef.current = null;
        port.disconnect();
      }
    };
    const onDisconnect = () => {
      if (portRef.current === port) portRef.current = null;
      if (documentReceived || terminal || !mountedRef.current) return;
      terminal = true;
      clearExportTimeout();
      setStatus("error");
      setMessage("后台连接在题面到达前中断，请回到题目页重新发起导出。");
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    setStatus("extracting");
    setMessage("正在读取题面…");
    try {
      port.postMessage(createProblemExportConnectMessage(token, fallbackJob));
    } catch {
      terminal = true;
      clearExportTimeout();
      portRef.current = null;
      port.disconnect();
      setStatus("error");
      setMessage("无法发送导出请求，请回到题目页重新发起导出。");
    }
    return () => {
      mountedRef.current = false;
      renderGeneration.current += 1;
      terminal = true;
      clearExportTimeout();
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      if (portRef.current === port) portRef.current = null;
      try {
        port.disconnect();
      } catch {
        // The port may already have disconnected after delivering the document.
      }
    };
  }, [renderDocument]);

  return (
    <main className="problem-export-page">
      <header className="problem-export-header">
        <span className="eyebrow">OJTrace · 题面工具</span>
        <h1>{problem?.title || "导出题面 PDF"}</h1>
      </header>
      <section className="problem-export-status" aria-live="polite">
        {status === "error" ? (
          <span className="status-icon">!</span>
        ) : status === "connecting" || status === "extracting" ? (
          <span className="status-spinner" aria-hidden="true" />
        ) : (
          <span className="status-success" aria-hidden="true">
            ✓
          </span>
        )}
        <p>{message}</p>
      </section>
      {problem?.warnings.length ? (
        <aside className="problem-export-warnings" role="status">
          <strong>题面提示</strong>
          <ul>
            {problem.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      {status === "error" && (
        <p className="problem-export-retry-hint">
          此次导出已结束，无法在此页重试。请回到题目页，点击扩展图标重新发起导出。
        </p>
      )}
    </main>
  );
}

export { ProblemExport };
