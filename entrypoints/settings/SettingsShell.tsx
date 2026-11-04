import { useEffect, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AppHeader } from "../shared/AppHeader";
import {
  settingsGroups,
  settingsSections,
  type SettingsSection,
} from "./settings-navigation";

export function SettingsShell({
  section,
  dirty,
  children,
}: {
  section: SettingsSection;
  dirty: Partial<Record<SettingsSection, boolean>>;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasDirty = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (!hasDirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [hasDirty]);
  useEffect(() => {
    document.title = `${settingsSections.find((item) => item.id === section)!.label} · OJTrace 设置`;
  }, [section]);
  return (
    <main
      className={`settings-shell${collapsed ? " is-sidebar-collapsed" : ""}`}
    >
      <AppHeader active="settings" />
      <div className="settings-content settings-layout">
        <aside className="settings-sidebar" aria-label="设置导航区域">
          <div className="settings-sidebar-heading">
            <span>设置</span>
            <button
              type="button"
              className="sidebar-toggle"
              aria-label={collapsed ? "展开设置导航" : "收起设置导航"}
              aria-expanded={!collapsed}
              aria-controls="settings-navigation"
              onClick={() => setCollapsed((value) => !value)}
              title={collapsed ? "展开导航" : "收起导航"}
            >
              <PanelLeftClose
                size={17}
                className="sidebar-icon-collapse"
                aria-hidden="true"
              />
              <PanelLeftOpen
                size={17}
                className="sidebar-icon-expand"
                aria-hidden="true"
              />
            </button>
          </div>
          <div className="settings-sidebar-body">
            <div className="settings-sidebar-body-inner">
              <nav id="settings-navigation" aria-label="设置分区">
                {settingsGroups.map((group) => (
                  <div className="settings-nav-group" key={group.label}>
                    <p className="settings-nav-group-title">{group.label}</p>
                    {group.items.map(({ id, label, icon: Icon }) => (
                      <a
                        key={id}
                        href={`#${id}`}
                        aria-current={id === section ? "page" : undefined}
                        aria-label={`${label}${dirty[id] ? "（未保存）" : ""}`}
                        title={label}
                        className="settings-nav-item"
                      >
                        <Icon size={17} strokeWidth={1.65} aria-hidden="true" />
                        <span className="settings-nav-label">{label}</span>
                        {dirty[id] && (
                          <i
                            className="settings-draft-dot"
                            aria-hidden="true"
                          />
                        )}
                      </a>
                    ))}
                  </div>
                ))}
              </nav>
              {hasDirty && (
                <p className="settings-draft-note" role="status">
                  <i className="settings-draft-dot" aria-hidden="true" />
                  <span>有未保存更改，切换分区会保留草稿。</span>
                </p>
              )}
            </div>
          </div>
        </aside>
        <div className="settings-workspace">{children}</div>
      </div>
    </main>
  );
}
