import { AnimatedSelect } from "../../shared/AnimatedSelect";
import { useState } from "react";
import {
  SECTION_ROLES,
  MAIN_ROLES,
  RULE_LANGUAGES,
  type CnoiRuleOverrides,
  type MappingSettings,
  type RuleContext,
  type RuleDescriptor,
  type RuleLanguage,
  type SectionRole,
  type CustomRule,
  type RuleIssue,
  type CnoiRuleCatalog,
} from "../../../src/domain/cnoi-rules";

export const roleNames: Record<SectionRole, string> = {
  background: "题目背景",
  description: "题目描述",
  input: "输入格式",
  output: "输出格式",
  samples: "样例包装",
  "sample-input": "样例输入",
  "sample-output": "样例输出",
  explanation: "样例说明",
  hint: "说明 / 提示",
};
const langNames = { zh: "中文", en: "English", ja: "日本語" };
function RoleSelect({
  value,
  onChange,
  label,
}: {
  value: SectionRole;
  onChange: (value: SectionRole) => void;
  label: string;
}) {
  return (
    <AnimatedSelect
      portal
      label={label}
      value={value}
      onChange={onChange}
      options={SECTION_ROLES.map((role) => ({
        value: role,
        label: roleNames[role],
      }))}
    />
  );
}
function ContextEditor({
  contexts,
  onChange,
  label,
}: {
  contexts: RuleContext[];
  onChange: (contexts: RuleContext[]) => void;
  label: string;
}) {
  return (
    <div className="rule-contexts">
      {contexts.map((context, index) => (
        <div className="context-row" key={index}>
          <AnimatedSelect
            portal
            label={`${label} 上下文 ${index + 1}`}
            value={context.kind}
            options={[
              { value: "root", label: "根章节" },
              { value: "parent", label: "指定父章节" },
              { value: "ancestor", label: "指定祖先章节" },
              { value: "any", label: "任何章节" },
            ]}
            onChange={(kind) =>
              onChange(
                contexts.map((c, i) =>
                  i !== index
                    ? c
                    : kind === "parent" || kind === "ancestor"
                      ? { kind, role: "samples" }
                      : { kind },
                ),
              )
            }
          />
          {(context.kind === "parent" || context.kind === "ancestor") && (
            <RoleSelect
              label={`${label} 上下文目标 ${index + 1}`}
              value={context.role}
              onChange={(role) =>
                onChange(
                  contexts.map((c, i) =>
                    i === index ? { ...context, role } : c,
                  ),
                )
              }
            />
          )}
          {contexts.length > 1 && (
            <button
              type="button"
              className="text-button"
              aria-label={`${label} 删除上下文 ${index + 1}`}
              onClick={() => onChange(contexts.filter((_, i) => i !== index))}
            >
              移除
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        disabled={contexts.length >= 12}
        onClick={() =>
          onChange([...contexts, { kind: "parent", role: "samples" }])
        }
      >
        添加或满足的上下文
      </button>
    </div>
  );
}
function MappingEditor({
  rule,
  onChange,
  children,
}: {
  rule: RuleDescriptor;
  onChange: (patch: Partial<MappingSettings>) => void;
  children?: React.ReactNode;
}) {
  return (
    <article className={`mapping-row${rule.enabled ? "" : " is-disabled"}`}>
      <div className="mapping-heading">
        <label className="check-label">
          <input
            type="checkbox"
            aria-label={`启用 ${rule.id}`}
            checked={rule.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          <span>{rule.label}</span>
        </label>
        <code>{rule.id}</code>
      </div>
      {children}
      <div className="mapping-target">
        <span>映射为</span>
        <RoleSelect
          label={`${rule.id} 目标章节`}
          value={rule.role}
          onChange={(role) => onChange({ role })}
        />
      </div>
      <details className="mapping-context">
        <summary>
          匹配上下文 ·{" "}
          {rule.contexts
            .map((c) =>
              c.kind === "root"
                ? "根章节"
                : c.kind === "any"
                  ? "任何章节"
                  : `${c.kind === "parent" ? "父" : "祖先"}：${roleNames[c.role]}`,
            )
            .join(" / ")}
        </summary>
        <ContextEditor
          label={rule.id}
          contexts={rule.contexts}
          onChange={(contexts) => onChange({ contexts })}
        />
      </details>
    </article>
  );
}
export function RuleConfigurationPanel({
  catalog,
  draft,
  edit,
  issues,
}: {
  catalog: CnoiRuleCatalog;
  draft: CnoiRuleOverrides;
  edit: (patch: Partial<CnoiRuleOverrides>) => void;
  issues: RuleIssue[];
}) {
  const [language, setLanguage] = useState<RuleLanguage>("en");
  const options = { ...catalog.options, ...draft };
  const defaultLabel = (lang: RuleLanguage, role: SectionRole) =>
    catalog.options.labels[lang]?.[role] ?? roleNames[role];
  const errors = (path: string) =>
    issues
      .filter((i) => i.path === path || i.path.startsWith(`${path}.`))
      .map((i, index) => (
        <p className="field-error" role="alert" key={`${i.path}-${index}`}>
          {i.message}
        </p>
      ));
  const toggle = (
    key:
      | "reorder"
      | "unwrapSamples"
      | "removeDocumentTitle"
      | "addDescriptionHeading",
    label: string,
  ) => (
    <label className="check-label">
      <input
        type="checkbox"
        checked={options[key]}
        onChange={(e) => edit({ [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  const changeCustom = (index: number, patch: Partial<CustomRule>) =>
    edit({
      customRules: (draft.customRules ?? []).map((r, i) =>
        i === index ? { ...r, ...patch } : r,
      ),
    });
  return (
    <section className="rule-configuration" aria-label="转换规则配置">
      <details className="rule-group" open>
        <summary>
          章节识别与映射
          <span>
            {catalog.rules.length + (draft.customRules?.length ?? 0)} 条规则
          </span>
        </summary>
        <div className="rule-group-body">
          <p className="rule-help">
            自定义匹配优先，其次是用户覆盖，再按内置语义优先级匹配。同级角色冲突时保留原结构并提示。祖先匹配不穿过未知标题或说明章节。
          </p>
          {catalog.rules.map((base) => {
            const rule = { ...base, ...draft.mappings?.[base.id] };
            return (
              <div key={base.id}>
                <MappingEditor
                  rule={rule}
                  onChange={(patch) =>
                    edit({
                      mappings: {
                        ...draft.mappings,
                        [base.id]: { ...draft.mappings?.[base.id], ...patch },
                      },
                    })
                  }
                />
                {errors(`mappings.${base.id}`)}
              </div>
            );
          })}
          <div className="custom-heading">
            <h3>自定义标题</h3>
            <button
              type="button"
              onClick={() =>
                edit({
                  customRules: [
                    ...(draft.customRules ?? []),
                    {
                      id: `user-${crypto.randomUUID()}`,
                      enabled: true,
                      role: "description",
                      contexts: [{ kind: "root" }],
                      matcher: { kind: "exact", text: "" },
                    },
                  ],
                })
              }
              disabled={(draft.customRules?.length ?? 0) >= 60}
            >
              新增规则
            </button>
          </div>
          {(draft.customRules ?? []).map((rule, index) => (
            <div key={rule.id}>
              <MappingEditor
                rule={{ ...rule, label: rule.matcher.text || "新标题匹配" }}
                onChange={(patch) => changeCustom(index, patch)}
              >
                <div className="custom-matcher">
                  <AnimatedSelect
                    portal
                    label={`${rule.id} 匹配方式`}
                    value={rule.matcher.kind}
                    options={[
                      { value: "exact", label: "完整标题" },
                      { value: "numbered", label: "含编号标题" },
                    ]}
                    onChange={(kind) =>
                      changeCustom(index, {
                        matcher:
                          kind === "exact"
                            ? { kind: "exact", text: rule.matcher.text }
                            : {
                                kind: "numbered",
                                text: `${rule.matcher.text} {number}`.trim(),
                                required: true,
                              },
                      })
                    }
                  />
                  <input
                    aria-label={`${rule.id} 标题匹配`}
                    placeholder={
                      rule.matcher.kind === "numbered"
                        ? "例如：Test {number}"
                        : "例如：输入说明"
                    }
                    value={rule.matcher.text}
                    maxLength={160}
                    onChange={(e) =>
                      changeCustom(index, {
                        matcher: { ...rule.matcher, text: e.target.value },
                      })
                    }
                  />
                  {rule.matcher.kind === "numbered" && (
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={rule.matcher.required}
                        onChange={(e) =>
                          changeCustom(index, {
                            matcher: {
                              ...rule.matcher,
                              kind: "numbered",
                              required: e.target.checked,
                            },
                          })
                        }
                      />
                      必须含编号
                    </label>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      edit({
                        customRules: draft.customRules?.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    删除此规则
                  </button>
                </div>
              </MappingEditor>
              {errors(`customRules.${index}`)}
            </div>
          ))}
          {errors("customRules").length > 0 &&
            !draft.customRules?.length &&
            errors("customRules")}
        </div>
      </details>
      <details className="rule-group">
        <summary>
          章节组织<span>顺序、层级与包装</span>
        </summary>
        <div className="rule-group-body">
          {toggle("reorder", "按主章节顺序组织")}
          <ol className="section-order">
            {options.order.map((role, index) => (
              <li key={role}>
                <span>{roleNames[role]}</span>
                <button
                  type="button"
                  aria-label={`上移${roleNames[role]}`}
                  disabled={!options.reorder || index === 0}
                  onClick={() => {
                    const order = [...options.order];
                    [order[index - 1], order[index]] = [
                      order[index]!,
                      order[index - 1]!,
                    ];
                    edit({ order });
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`下移${roleNames[role]}`}
                  disabled={!options.reorder || index === MAIN_ROLES.length - 1}
                  onClick={() => {
                    const order = [...options.order];
                    [order[index], order[index + 1]] = [
                      order[index + 1]!,
                      order[index]!,
                    ];
                    edit({ order });
                  }}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
          {errors("order")}
          <p className="rule-help">
            样例输入、输出和说明保持关联顺序。未知章节与重复格式章节是排序锚点。
          </p>
          <label className="field-label">
            主章节标题层级
            <AnimatedSelect
              portal
              label="主章节标题层级"
              value={options.sectionLevel}
              onChange={(sectionLevel) => edit({ sectionLevel })}
              options={[1, 2, 3, 4, 5, 6].map((n) => ({
                value: n,
                label: `H${n} · ${"#".repeat(n)}`,
              }))}
            />
          </label>
          {errors("sectionLevel")}
          {toggle("unwrapSamples", "展开已识别的样例包装标题")}
          {toggle("removeDocumentTitle", "移除与元信息重复的题目标题")}
          {toggle("addDescriptionHeading", "为无标题的开篇正文补充描述标题")}
        </div>
      </details>
      <details className="rule-group">
        <summary>
          样例处理<span>编号与标题格式</span>
        </summary>
        <div className="rule-group-body">
          <label className="field-label">
            样例编号
            <AnimatedSelect
              portal
              label="样例编号"
              value={options.numbering}
              onChange={(numbering) => edit({ numbering })}
              options={[
                { value: "preserve", label: "保留原编号" },
                { value: "inherit-group", label: "缺少编号时继承明确父组编号" },
              ]}
            />
          </label>
          {errors("numbering")}
          <p className="rule-help">
            不重编号，不按位置配对输入输出。冲突编号与无明确归属的内容保留原文。
          </p>
          <label className="field-label">
            样例标题
            <AnimatedSelect
              portal
              label="样例标题"
              value={options.sampleTitleMode}
              onChange={(sampleTitleMode) => edit({ sampleTitleMode })}
              options={[
                { value: "contextual", label: "按原文语言补全样例语境" },
                { value: "original", label: "保留原标题" },
                { value: "template", label: "使用语言模板" },
              ]}
            />
          </label>
          {errors("sampleTitleMode")}
          {options.sampleTitleMode === "template" && (
            <>
              <LanguageSelect language={language} setLanguage={setLanguage} />
              {(["input", "output"] as const).map((key) => (
                <label className="field-label" key={key}>
                  {key === "input" ? "样例输入模板" : "样例输出模板"}
                  <input
                    aria-label={
                      key === "input" ? "样例输入模板" : "样例输出模板"
                    }
                    value={
                      options.sampleTemplates[language]?.[key] ??
                      `${defaultLabel(language, `sample-${key}`)}{numberSuffix}`
                    }
                    onChange={(e) =>
                      edit({
                        sampleTemplates: {
                          ...options.sampleTemplates,
                          [language]: {
                            input:
                              options.sampleTemplates[language]?.input ??
                              `${defaultLabel(language, "sample-input")}{numberSuffix}`,
                            output:
                              options.sampleTemplates[language]?.output ??
                              `${defaultLabel(language, "sample-output")}{numberSuffix}`,
                            [key]: e.target.value,
                          },
                        },
                      })
                    }
                  />
                  {errors(`sampleTemplates.${language}.${key}`)}
                </label>
              ))}
              <p className="rule-help">
                支持 {"{number}"} 与 {"{numberSuffix}"}；后者在有编号时生成「
                #7」，无编号时为空。
              </p>
            </>
          )}
        </div>
      </details>
      <details className="rule-group">
        <summary>
          标题规范<span>按题面语言生效</span>
        </summary>
        <div className="rule-group-body">
          <label className="field-label">
            章节标题
            <AnimatedSelect
              portal
              label="章节标题"
              value={options.headingMode}
              onChange={(headingMode) => edit({ headingMode })}
              options={[
                { value: "original", label: "保留原标题" },
                { value: "canonical", label: "使用规范标题" },
              ]}
            />
          </label>
          <LanguageSelect language={language} setLanguage={setLanguage} />
          <p className="rule-help">
            这里只编辑对应语言的标题。英文、日文题面不会自动中文化。
          </p>
          <fieldset
            disabled={options.headingMode !== "canonical"}
            className="heading-labels"
          >
            {SECTION_ROLES.filter((r) => !r.startsWith("sample-")).map(
              (role) => (
                <label className="field-label" key={role}>
                  {roleNames[role]}
                  <input
                    value={
                      options.labels[language]?.[role] ??
                      defaultLabel(language, role)
                    }
                    onChange={(e) =>
                      edit({
                        labels: {
                          ...options.labels,
                          [language]: {
                            ...options.labels[language],
                            [role]: e.target.value,
                          },
                        },
                      })
                    }
                  />
                  {errors(`labels.${language}.${role}`)}
                </label>
              ),
            )}
          </fieldset>
        </div>
      </details>
    </section>
  );
}
function LanguageSelect({
  language,
  setLanguage,
}: {
  language: RuleLanguage;
  setLanguage: (l: RuleLanguage) => void;
}) {
  return (
    <label className="field-label">
      配置语言
      <AnimatedSelect
        portal
        label="配置语言"
        value={language}
        onChange={setLanguage}
        options={RULE_LANGUAGES.map((lang) => ({
          value: lang,
          label: langNames[lang],
        }))}
      />
    </label>
  );
}
