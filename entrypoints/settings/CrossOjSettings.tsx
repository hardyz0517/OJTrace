import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  hasCloudflareChallengePermission,
  removeCloudflareChallengePermission,
  requestCloudflareChallengePermission,
} from "../../src/oj-enhancer/features/cross-oj-submit/client";

export function CrossOjSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void hasCloudflareChallengePermission().then((granted) => {
      if (active) setEnabled(granted);
    });
    return () => {
      active = false;
    };
  }, []);

  async function updatePermission(nextEnabled: boolean): Promise<void> {
    if (busy || enabled === null) return;
    setBusy(true);
    setError(null);
    try {
      const updated = nextEnabled
        ? await requestCloudflareChallengePermission()
        : await removeCloudflareChallengePermission();
      if (!updated)
        throw new Error(
          nextEnabled
            ? "未授予 Cloudflare 页面权限，请重试。"
            : "无法撤销 Cloudflare 页面权限，请重试。",
        );
      setEnabled(nextEnabled);
    } catch (reason) {
      setEnabled(await hasCloudflareChallengePermission());
      setError(reason instanceof Error ? reason.message : "设置失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section luogu-enhancement-section">
      <header className="settings-module-heading">
        <h1>跨 OJ 提交</h1>
      </header>
      <div className="settings-feature-card">
        <div className="settings-feature-icon" aria-hidden="true">
          <ShieldCheck size={18} />
        </div>
        <div className="settings-feature-copy">
          <h2>Cloudflare 验证等待优化</h2>
          <p>
            允许插件在 Cloudflare
            验证页延长验证请求的等待时间，改善网络较慢时的验证超时。仅作用于
            Cloudflare 验证页面；关闭后会撤销对应站点权限。
          </p>
        </div>
        <label className="settings-switch">
          <span className="sr-only">启用 Cloudflare 验证等待优化</span>
          <input
            type="checkbox"
            checked={enabled ?? false}
            disabled={busy || enabled === null}
            onChange={(event) => void updatePermission(event.target.checked)}
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
