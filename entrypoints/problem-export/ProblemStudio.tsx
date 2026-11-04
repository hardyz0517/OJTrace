import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  parseProblemMarkdown,
  readProblemMarkdown,
} from "../../src/problem/problem-markdown";
import {
  problemDisplayName,
  type CnoiProblem,
  type RenderDocument,
  type ProblemWarning,
} from "../../src/problem/domain";
import { compileDiagnostic } from "../../src/problem/render/compile-diagnostic";
import { downloadPdf } from "./download-pdf";
import { isPdf, safeFilename } from "../../src/problem/render/pdf-file";
import { parseTypstSvg, TypstPreview } from "./TypstPreview";
import { MarkdownEditor } from "../shared/MarkdownEditor";

const PREVIEW_DELAY_MS = 400;

interface PendingPreview {
  id: number;
  markdown: string;
  download: boolean;
}

export function ProblemStudio({
  base,
  renderPreview,
  renderPdf,
}: {
  base: CnoiProblem;
  renderPreview: (document: RenderDocument) => Promise<string>;
  renderPdf: (document: RenderDocument) => Promise<Uint8Array>;
}): ReactElement {
  const [editedMarkdown, setEditedMarkdown] = useState(base.cnoiMarkdown);
  const editedRef = useRef(editedMarkdown);
  const renderContext = useRef({ base, renderPdf, renderPreview });
  renderContext.current = { base, renderPdf, renderPreview };
  const header = useMemo(
    () => readProblemMarkdown(editedMarkdown),
    [editedMarkdown],
  );
  const [previewSvg, setPreviewSvg] = useState<SVGSVGElement | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly ProblemWarning[]>(
    base.warnings,
  );
  const [rendering, setRendering] = useState(false);
  const latestId = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef<PendingPreview | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const previewSvgRef = useRef<SVGSVGElement | null>(null);
  const success = useRef<{
    markdown: string;
    bytes: Uint8Array;
    filename: string;
    base: CnoiProblem;
  } | null>(null);

  const pump = useCallback(async () => {
    if (inFlight.current || !pending.current) return;
    const job = pending.current;
    pending.current = null;
    inFlight.current = true;
    if (mounted.current) setRendering(true);
    let downloaded = false;
    try {
      const { base, renderPdf, renderPreview } = renderContext.current;
      const applied = parseProblemMarkdown(job.markdown, base);
      if (!applied.ok) {
        if (mounted.current && job.id === latestId.current) {
          setPreviewStale(previewSvgRef.current !== null);
          setDiagnostic(applied.message);
        }
        return;
      }
      if (job.download) {
        const bytes = await renderPdf(applied.value);
        if (!mounted.current || job.id !== latestId.current) return;
        if (!isPdf(bytes)) throw new Error("PDF 数据校验失败");
        const filename = safeFilename(applied.value);
        success.current = { markdown: job.markdown, bytes, filename, base };
        downloadPdf(bytes, filename);
        downloaded = true;
      }
      const svg = await renderPreview(applied.value);
      if (!mounted.current || job.id !== latestId.current) return;
      const graphic = parseTypstSvg(svg);
      previewSvgRef.current = graphic;
      setPreviewSvg(graphic);
      setPreviewStale(false);
      setDiagnostic(null);
      setWarnings(applied.value.warnings);
    } catch (error) {
      if (mounted.current && job.id === latestId.current) {
        setPreviewStale(previewSvgRef.current !== null);
        const detail = compileDiagnostic(error);
        setDiagnostic(
          downloaded ? `PDF 已下载。预览未能更新。${detail}` : detail,
        );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setRendering(false);
      if (pending.current) void pump();
    }
  }, []);

  const schedule = useCallback(
    (source: string, download: boolean, immediate = false) => {
      const id = ++latestId.current;
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        timer.current = undefined;
      }
      const queue = () => {
        timer.current = undefined;
        pending.current = { id, markdown: source, download };
        void pump();
      };
      if (download || immediate || pending.current) queue();
      else timer.current = window.setTimeout(queue, PREVIEW_DELAY_MS);
    },
    [pump],
  );

  useEffect(() => {
    mounted.current = true;
    schedule(editedRef.current, false, true);
    return () => {
      mounted.current = false;
      latestId.current += 1;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = undefined;
      pending.current = null;
    };
  }, [base, schedule]);

  function editMarkdown(source: string, composingNow: boolean) {
    setEditedMarkdown(source);
    editedRef.current = source;
    if (composingNow) {
      latestId.current += 1;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = undefined;
      pending.current = null;
      return;
    }
    schedule(source, false);
  }

  function exportCurrent() {
    const saved = success.current;
    if (saved && saved.base === base && saved.markdown === editedMarkdown) {
      downloadPdf(saved.bytes, saved.filename);
      return;
    }
    schedule(editedMarkdown, true);
  }

  return (
    <main className="problem-studio">
      <header className="problem-studio-header">
        <nav className="problem-studio-breadcrumb" aria-label="当前位置">
          <span>OJTrace</span>
          <span aria-hidden="true">/</span>
          <span>题面工具</span>
          <span aria-hidden="true">/</span>
          <span className="problem-studio-identity">
            {header.ok
              ? `${problemDisplayName(header.value.metadata.oj)} ${header.value.metadata.problemId}`
              : "元信息待修复"}
          </span>
        </nav>
        <button type="button" className="studio-export" onClick={exportCurrent}>
          导出 PDF
        </button>
      </header>
      {warnings.length ? (
        <aside className="problem-export-warnings" role="status">
          <strong>题面提示</strong>
          <ul>
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </aside>
      ) : null}
      <div className="problem-studio-frame">
        <div className="problem-studio-columns">
          <section className="problem-studio-editor">
            <MarkdownEditor value={editedMarkdown} onChange={editMarkdown} />
          </section>
          <section className="problem-studio-preview" aria-label="题面预览">
            <div className="preview-banner" aria-live="polite">
              {rendering && previewSvg ? (
                <p className="preview-rendering">正在更新预览…</p>
              ) : null}
              {previewStale ? (
                <p className="preview-stale">
                  预览已过期，当前内容还没有成功生成预览。
                </p>
              ) : null}
              {diagnostic ? (
                <div className="preview-diagnostic" role="alert">
                  <p>{diagnostic}</p>
                  <button
                    type="button"
                    disabled={rendering}
                    onClick={() => schedule(editedMarkdown, false, true)}
                  >
                    重新生成预览
                  </button>
                </div>
              ) : null}
            </div>
            {previewSvg ? (
              <TypstPreview svg={previewSvg} />
            ) : (
              <p className="preview-pending">
                {rendering ? "正在生成预览…" : "还没有可显示的预览。"}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
