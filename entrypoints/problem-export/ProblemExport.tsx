import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { CnoiProblem, RenderDocument } from "../../src/problem/domain";
import { WorkerProblemRenderer } from "../../src/problem/render/worker-problem-renderer";
import { isCnoiProblem } from "../../src/problem/validate-document";
import { ProblemStudio } from "./ProblemStudio";
import {
  isProblemExportPortEvent,
  type ProblemExportFallbackJob,
  type ProblemExportPortEvent,
} from "../../src/application/problem-export/messages";
import { createProblemExportConnectMessage } from "../../src/application/problem-export/transport";

type ExportStatus = "connecting" | "extracting" | "error";

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
  const [studioBase, setStudioBase] = useState<CnoiProblem | null>(null);
  const renderer = useRef<WorkerProblemRenderer | null>(null);
  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(
    null,
  );
  const mountedRef = useRef(false);

  useEffect(() => () => renderer.current?.dispose(), []);

  useEffect(() => {
    mountedRef.current = true;
    const token = tokenFromLocation();
    if (!token) {
      setStatus("error");
      setMessage("导出任务已失效，请回到题目页重新发起导出。");
      return () => {
        mountedRef.current = false;
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
      };
    }
    portRef.current = port;
    let documentReceived = false;
    let terminal = false;
    const timeout = window.setTimeout(() => {
      if (!mountedRef.current) return;
      if (terminal) return;
      terminal = true;
      setStatus("error");
      setMessage("读取题面超时，请回到题目页重新发起导出。");
      portRef.current = null;
      port.disconnect();
    }, EXPORT_TIMEOUT_MS);
    const clearExportTimeout = () => {
      window.clearTimeout(timeout);
    };
    const onMessage = (raw: unknown) => {
      if (!mountedRef.current) return;
      if (
        raw &&
        typeof raw === "object" &&
        "schemaVersion" in raw &&
        raw.schemaVersion !== 2
      ) {
        terminal = true;
        clearExportTimeout();
        setStatus("error");
        setMessage("扩展已更新，请关闭此页并重新发起导出。");
        port.disconnect();
        return;
      }
      if (!isProblemExportPortEvent(raw)) return;
      const event = raw;
      if (event.token !== token || terminal || documentReceived) return;
      if (event.type === "PROBLEM_EXPORT_PROGRESS") {
        setStatus("extracting");
        setMessage(
          event.phase === "capturing" ? "正在读取题面…" : "正在提取题面…",
        );
      } else if (event.type === "PROBLEM_EXPORT_DOCUMENT") {
        if (!isCnoiProblem(event.problem)) {
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
        port.disconnect();
        clearExportTimeout();
        setStudioBase(event.problem);
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
  }, []);

  const renderPdf = useCallback((document: RenderDocument) => {
    renderer.current ??= new WorkerProblemRenderer();
    return renderer.current.pdf(document);
  }, []);

  const renderPreview = useCallback((document: RenderDocument) => {
    renderer.current ??= new WorkerProblemRenderer();
    return renderer.current.preview(document);
  }, []);

  if (studioBase) {
    return (
      <ProblemStudio
        key={tokenFromLocation()}
        base={studioBase}
        renderPdf={renderPdf}
        renderPreview={renderPreview}
      />
    );
  }

  return (
    <main className="problem-export-page">
      <header className="problem-export-header">
        <span className="eyebrow">OJTrace · 题面工具</span>
        <h1>题面编辑器</h1>
      </header>
      <section className="problem-export-status" aria-live="polite">
        {status === "error" ? (
          <span className="status-icon">!</span>
        ) : (
          <span className="status-spinner" aria-hidden="true" />
        )}
        <p>{message}</p>
      </section>
      {status === "error" && (
        <p className="problem-export-retry-hint">
          此次导出已结束，无法在此页重试。请回到题目页，点击扩展图标重新发起导出。
        </p>
      )}
    </main>
  );
}

export { ProblemExport };
