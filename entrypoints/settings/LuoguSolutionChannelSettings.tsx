import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { PublicStoredData } from "../../src/application/accounts/account-queries";
import type { Preferences } from "../../src/domain";
import {
  createRuntimeMessage,
  sendRuntimeMessage,
} from "../shared/runtime-client";

export function LuoguSolutionChannelSettings({
  preferences,
  onUpdated,
}: {
  preferences: Preferences;
  onUpdated: (data: PublicStoredData) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(enabled: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await sendRuntimeMessage(
        createRuntimeMessage({
          type: "UPDATE_LUOGU_SOLUTION_CHANNEL",
          enabled,
        }),
      );
      if (!response.ok) throw new Error(response.error.message);
      if (response.type !== "UPDATED") throw new Error("保存失败，请重试。");
      await onUpdated(response.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section luogu-enhancement-section">
      <header className="settings-module-heading">
        <h1>洛谷页面增强</h1>
      </header>
      <div className="settings-feature-card">
        <div className="settings-feature-icon" aria-hidden="true">
          <Sparkles size={18} />
        </div>
        <div className="settings-feature-copy">
          <h2>题解通道状态标签</h2>
          <p>
            在洛谷题目页的标签卡片中显示“题解通道开放”。仅当官方题目数据明确允许提交题解时显示。
          </p>
        </div>
        <label className="settings-switch">
          <span className="sr-only">启用题解通道状态标签</span>
          <input
            type="checkbox"
            checked={preferences.luoguSolutionChannelEnabled}
            disabled={busy}
            onChange={(event) => void save(event.target.checked)}
          />
          <span className="settings-switch-track" aria-hidden="true" />
        </label>
      </div>
      {error ? (
        <p className="pagination-feedback is-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
