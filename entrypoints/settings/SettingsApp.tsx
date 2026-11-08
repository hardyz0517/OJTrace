import { useCallback, useState } from "react";
import { AccountsSettings } from "./AccountsSettings";
import { PaginationSettings } from "./PaginationSettings";
import { LocalDataSettings } from "./LocalDataSettings";
import { CnoiRulesSettings } from "./cnoi/CnoiRulesSettings";
import { LuoguSolutionChannelSettings } from "./LuoguSolutionChannelSettings";
import { CrossOjSettings } from "./CrossOjSettings";
import { SettingsShell } from "./SettingsShell";
import { useSettingsData } from "./useSettingsData";
import {
  settingsSections,
  useSettingsNavigation,
  type SettingsSection,
} from "./settings-navigation";

export function SettingsApp() {
  const section = useSettingsNavigation();
  const { data, error, load } = useSettingsData();
  const [visited, setVisited] = useState<SettingsSection[]>([section]);
  // Retain visited modules, including forms and CodeMirror documents. Drafts stay
  // in this tab's memory; credentials and custom Source are never draft-persisted.
  if (!visited.includes(section)) setVisited([...visited, section]);
  const [dirty, setDirty] = useState<Partial<Record<SettingsSection, boolean>>>(
    {},
  );
  const report = useCallback((id: SettingsSection, value: boolean) => {
    setDirty((current) =>
      current[id] === value ? current : { ...current, [id]: value },
    );
  }, []);
  const accountsDirty = useCallback(
    (value: boolean) => report("accounts", value),
    [report],
  );
  const collectionDirty = useCallback(
    (value: boolean) => report("collection", value),
    [report],
  );
  const cnoiDirty = useCallback(
    (value: boolean) => report("cnoi", value),
    [report],
  );
  return (
    <SettingsShell section={section} dirty={dirty}>
      {error && (
        <div className="settings-load-error" role="alert">
          {error}{" "}
          <button
            type="button"
            className="secondary-button"
            onClick={() => void load()}
          >
            重试
          </button>
        </div>
      )}
      {settingsSections
        .filter(({ id }) => visited.includes(id))
        .map(({ id, label }) => (
          <div
            key={id}
            className={`settings-panel${id === "cnoi" ? " settings-panel-wide" : ""}`}
            hidden={section !== id}
            role="region"
            aria-label={label}
          >
            {id === "accounts" && (
              <AccountsSettings
                data={data}
                onUpdated={load}
                onDirtyChange={accountsDirty}
              />
            )}
            {id === "collection" &&
              (data ? (
                <PaginationSettings
                  preferences={data.preferences}
                  onUpdated={load}
                  onDirtyChange={collectionDirty}
                />
              ) : (
                <p className="muted">正在读取采集设置…</p>
              ))}
            {id === "cnoi" && <CnoiRulesSettings onDirtyChange={cnoiDirty} />}
            {id === "luogu" &&
              (data ? (
                <LuoguSolutionChannelSettings
                  preferences={data.preferences}
                  onUpdated={load}
                />
              ) : (
                <p className="muted">正在读取页面增强设置…</p>
              ))}
            {id === "cross-oj" && <CrossOjSettings />}
            {id === "data" && <LocalDataSettings onUpdated={load} />}
          </div>
        ))}
    </SettingsShell>
  );
}
