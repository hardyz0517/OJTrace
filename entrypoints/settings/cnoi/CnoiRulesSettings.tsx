import { useEffect, useMemo } from "react";
import { RotateCcw, Save } from "lucide-react";
import { OJName } from "../../shared/OJName";
import { AnimatedSelect } from "../../shared/AnimatedSelect";
import { sourceDefinitions } from "../../../src/sources/definitions";
import { validateCnoiOverrides } from "../../../src/domain/cnoi-rules";
import { useRulesWorkspace, dirty } from "./useRulesWorkspace";
import { RuleConfigurationPanel } from "./RuleConfigurationPanel";
import { ConversionPreviewPanel } from "./ConversionPreviewPanel";

export function CnoiRulesSettings({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const workspace = useRulesWorkspace();
  const { source, session, edit } = workspace;
  useEffect(() => {
    onDirtyChange?.(workspace.hasDirty || workspace.saving);
  }, [onDirtyChange, workspace.hasDirty, workspace.saving]);
  const validation = useMemo(
    () => (session ? validateCnoiOverrides(session.draft) : []),
    [session],
  );
  const issues = [...validation, ...(session?.errors ?? [])];
  const modified = session ? dirty(session) : false;
  const hasOtherDrafts = Object.entries(workspace.sessions).some(
    ([key, s]) => key !== source && s && dirty(s),
  );
  return (
    <section className="cnoi-rules-settings">
      <header className="settings-module-heading">
        <h1>CNOI 转换规则</h1>
        <p>调整 Source Markdown 的章节结构。规则按 OJ 独立生效。</p>
      </header>
      <div className="rules-toolbar">
        <div className="source-picker">
          <label htmlFor="rules-source">当前 OJ</label>
          <AnimatedSelect
            id="rules-source"
            label="当前 OJ"
            portal
            value={source}
            onChange={(source) => {
              workspace.setSource(source);
              workspace.setMessage("");
            }}
            options={Object.values(sourceDefinitions).map(({ metadata }) => ({
              value: metadata.id,
              label: (
                <OJName source={metadata.id} size="small">
                  {metadata.displayName}
                </OJName>
              ),
            }))}
          />
        </div>
        <span
          className={`rules-save-state${modified ? " is-dirty" : ""}`}
          role="status"
        >
          {!session
            ? "正在读取…"
            : modified
              ? "未保存"
              : session.state.entry
                ? "已自定义"
                : "默认"}
          {hasOtherDrafts && " · 其他 OJ 有草稿"}
        </span>
        <div className="rules-toolbar-actions">
          <button
            type="button"
            disabled={!session || workspace.saving}
            onClick={() =>
              workspace.update(source, (s) => ({
                ...s,
                draft: {},
                errors: [],
              }))
            }
          >
            <RotateCcw size={15} />
            恢复默认
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={
              !session ||
              !modified ||
              issues.length > 0 ||
              workspace.saving ||
              session.external
            }
            onClick={() => void workspace.save()}
          >
            <Save size={15} />
            {workspace.saving ? "保存中…" : "保存规则"}
          </button>
        </div>
      </div>
      {workspace.message && (
        <p className="rules-message" role="status">
          {workspace.message}
        </p>
      )}
      {session?.external && (
        <div className="rules-conflict" role="alert">
          此 OJ 的规则已在其他页面修改，当前草稿已保留。
          <button
            type="button"
            onClick={() => void workspace.load(source, true)}
          >
            读取最新基线并保留草稿
          </button>
        </div>
      )}
      {session?.state.issues.length ? (
        <div className="rules-conflict" role="alert">
          {session.state.issues.map((issue, i) => (
            <p key={i}>{issue.message}</p>
          ))}
        </div>
      ) : null}
      {issues
        .filter(
          (i) =>
            !i.path ||
            (!i.path.startsWith("customRules") &&
              !i.path.startsWith("mappings") &&
              !i.path.startsWith("labels") &&
              !i.path.startsWith("sampleTemplates") &&
              ![
                "sectionLevel",
                "order",
                "numbering",
                "sampleTitleMode",
              ].includes(i.path)),
        )
        .map((issue, i) => (
          <p key={i} className="field-error" role="alert">
            {issue.message}
          </p>
        ))}
      {session ? (
        <div className="rules-workspace">
          <RuleConfigurationPanel
            catalog={session.state.catalog}
            draft={session.draft}
            edit={edit}
            issues={issues}
          />
          <ConversionPreviewPanel
            source={source}
            fixture={session.fixture}
            custom={session.custom}
            draft={session.draft}
            valid={!issues.length}
            onFixture={(fixture) =>
              workspace.update(source, (s) => ({ ...s, fixture }))
            }
            onCustom={(fixture) =>
              workspace.update(source, (s) => ({
                ...s,
                fixture,
                custom: fixture,
              }))
            }
          />
        </div>
      ) : (
        <p className="rules-loading">正在读取内置规则与用户配置…</p>
      )}
    </section>
  );
}
