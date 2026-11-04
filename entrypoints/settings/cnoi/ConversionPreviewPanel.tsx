import { AnimatedSelect } from "../../shared/AnimatedSelect";
import { useMemo, useState } from "react";
import type { CnoiRuleOverrides } from "../../../src/domain/cnoi-rules";
import { readProblemMarkdown } from "../../../src/problem/problem-markdown";
import { MarkdownEditor } from "../../shared/MarkdownEditor";
import { useConversionPreview } from "./useConversionPreview";
import { markdownDiff } from "./line-diff";
import { previewFixtures, type PreviewFixture } from "./fixtures";
import type { SourceId } from "../../../src/domain/types";

const noop = () => {};
export function ConversionPreviewPanel({
  source,
  fixture,
  custom,
  draft,
  valid,
  onFixture,
  onCustom,
}: {
  source: SourceId;
  fixture: PreviewFixture;
  custom?: PreviewFixture;
  draft: CnoiRuleOverrides;
  valid: boolean;
  onFixture: (f: PreviewFixture) => void;
  onCustom: (f: PreviewFixture) => void;
}) {
  const [diff, setDiff] = useState(true);
  const [full, setFull] = useState(false);
  const [composition, setComposition] = useState({ source, active: false });
  const composing = composition.source === source && composition.active;
  const conversion = useConversionPreview({
    source,
    markdown: fixture.markdown,
    metadata: fixture.metadata,
    draft,
    valid,
    composing,
  });
  const { preview, fresh, error } = conversion;
  const body = useMemo(() => {
    if (!preview) return "";
    if (full) return preview.markdown;
    const read = readProblemMarkdown(preview.markdown);
    return read.ok ? read.value.body : preview.markdown;
  }, [preview, full]);
  const changes = useMemo(
    () => markdownDiff(preview?.sourceMarkdown ?? "", body),
    [preview, body],
  );
  const customize = (markdown: string, isComposing = false) => {
    setComposition({ source, active: isComposing });
    onCustom({ ...fixture, id: "custom", name: "自定义 Source", markdown });
  };
  return (
    <section
      className="conversion-workbench"
      aria-label="实时转换工作台"
      data-preview-state={conversion.state}
    >
      <div className="preview-toolbar">
        <label>
          测试题面
          <AnimatedSelect
            portal
            label="测试题面"
            value={fixture.id}
            options={[
              ...previewFixtures[source].map((f) => ({
                value: f.id,
                label: f.name,
              })),
              { value: "custom", label: "自定义 Source Markdown" },
            ]}
            onChange={(id) => {
              if (id === "custom")
                onFixture(
                  custom ?? { ...fixture, id: "custom", name: "自定义 Source" },
                );
              else onFixture(previewFixtures[source].find((f) => f.id === id)!);
            }}
          />
        </label>
        <span
          className="preview-status"
          role="status"
          aria-atomic="true"
          title={
            preview && !fresh
              ? "右侧保留上次成功结果，输入完成后自动更新。"
              : undefined
          }
        >
          {conversion.status}
        </span>
      </div>
      <details className="preview-metadata">
        <summary>
          测试元信息 · {fixture.metadata.language} ·{" "}
          {fixture.metadata.problemId}
        </summary>
        <div className="metadata-grid">
          <label>
            题面语言
            <AnimatedSelect
              portal
              label="测试题面语言"
              value={fixture.metadata.language ?? "other"}
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
                { value: "ja", label: "日本語" },
                { value: "other", label: "其他 / 保留原标题" },
              ]}
              onChange={(language) =>
                onCustom({
                  ...fixture,
                  id: "custom",
                  name: "自定义 Source",
                  metadata: { ...fixture.metadata, language },
                })
              }
            />
          </label>
          {(["problemId", "title", "originalUrl"] as const).map((key) => (
            <label key={key}>
              {key === "problemId"
                ? "题号"
                : key === "title"
                  ? "题目标题"
                  : "来源 URL"}
              <input
                value={fixture.metadata[key]}
                onChange={(e) =>
                  onCustom({
                    ...fixture,
                    id: "custom",
                    name: "自定义 Source",
                    metadata: { ...fixture.metadata, [key]: e.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      </details>
      <div className="comparison-options">
        <label className="check-label">
          <input
            type="checkbox"
            checked={diff}
            onChange={(e) => setDiff(e.target.checked)}
          />
          差异高亮
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={full}
            onChange={(e) => setFull(e.target.checked)}
          />
          显示完整 CNOI 元信息
        </label>
        {diff && (
          <span className="diff-legend">
            <i className="legend-remove" />
            删除 <i className="legend-add" />
            新增 <i className="legend-move" />
            移动
          </span>
        )}
      </div>
      <div className="markdown-comparison">
        <div className="comparison-pane">
          <h2>
            Source Markdown<span>编辑后转为自定义案例</span>
          </h2>
          <MarkdownEditor
            key={`source-${source}`}
            value={fixture.markdown}
            ariaLabel="Source Markdown"
            onChange={customize}
            lineKinds={diff && fresh ? changes.source : undefined}
          />
        </div>
        <div
          className="comparison-pane"
          aria-busy={
            conversion.state === "pending" ||
            conversion.state === "running" ||
            conversion.state === "composing"
          }
        >
          <h2>
            CNOI Markdown<span>真实 Transformer 输出</span>
          </h2>
          <MarkdownEditor
            key={`cnoi-${source}`}
            value={body}
            ariaLabel="CNOI Markdown"
            onChange={noop}
            readOnly
            lineKinds={diff ? changes.target : undefined}
          />
        </div>
      </div>
      <aside className="conversion-diagnostics" aria-label="转换诊断">
        <div className="diagnostics-heading">
          <h3>结构提示</h3>
          <span>
            {preview?.warnings.length ?? 0} 项
            {preview && !fresh ? " · 上次结果" : ""}
          </span>
        </div>
        {error && (
          <div className="preview-error" role="alert">
            <span>
              {error}
              {preview ? " 已保留上次成功结果。" : ""}
            </span>
            <button type="button" onClick={conversion.retry}>
              重试预览
            </button>
          </div>
        )}
        {preview?.warnings.length ? (
          <ul>
            {preview.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                <code>{warning.code}</code>
                <p>{warning.message}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rule-help">
            {preview
              ? fresh
                ? "未发现需要人工确认的结构。"
                : "当前输入待更新，以上为上次成功转换的结构提示。"
              : "转换完成后在这里显示结构提示。"}
          </p>
        )}
        <p className="rule-help">
          未识别内容始终保留。提示不会无意义地阻止题面导出。
        </p>
      </aside>
    </section>
  );
}
