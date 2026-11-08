import { useEffect, useState } from "react";
import {
  Database,
  ListFilter,
  SlidersHorizontal,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

export const settingsGroups = [
  {
    label: "账号与同步",
    items: [
      { id: "accounts", label: "OJ 账号", icon: Users },
      { id: "collection", label: "采集与同步", icon: ListFilter },
    ],
  },
  {
    label: "OJ 增强",
    items: [
      { id: "cnoi", label: "CNOI 转换规则", icon: SlidersHorizontal },
      { id: "luogu", label: "洛谷页面增强", icon: Sparkles },
      { id: "cross-oj", label: "跨 OJ 提交", icon: Workflow },
    ],
  },
  {
    label: "数据与隐私",
    items: [{ id: "data", label: "本地数据", icon: Database }],
  },
] as const;

export type SettingsSection =
  (typeof settingsGroups)[number]["items"][number]["id"];
export const settingsSections = settingsGroups.flatMap((group) => [
  ...group.items,
]);

function currentSection(): SettingsSection {
  return (
    settingsSections.find((section) => `#${section.id}` === location.hash)
      ?.id ?? "accounts"
  );
}

/** Hash selects a workspace, never a scroll target. Native history owns back/forward. */
export function useSettingsNavigation() {
  const [section, setSection] = useState(currentSection);
  useEffect(() => {
    const update = () => {
      const next = currentSection();
      if (location.hash !== `#${next}`) {
        history.replaceState(null, "", `#${next}`);
      }
      setSection(next);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return section;
}
