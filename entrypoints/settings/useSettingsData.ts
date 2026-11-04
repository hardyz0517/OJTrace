import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicStoredData } from "../../src/application/accounts/account-queries";
import {
  createRuntimeMessage,
  sendRuntimeMessage,
} from "../shared/runtime-client";

export function useSettingsData() {
  const [data, setData] = useState<PublicStoredData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const request = ++sequence.current;
    try {
      const response = await sendRuntimeMessage(
        createRuntimeMessage({ type: "GET_STATE" }),
      );
      if (request !== sequence.current) return;
      if (!response.ok) throw new Error(response.error.message);
      if (response.type !== "STATE")
        throw new Error("设置响应格式错误，请重试。");
      setData(response.data);
      setError(null);
    } catch (error) {
      if (request === sequence.current)
        setError(
          error instanceof Error ? error.message : "设置读取失败，请重试。",
        );
    }
  }, []);
  useEffect(() => {
    void load();
    const changed = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && Object.hasOwn(changes, "ojtrace:data"))
        void load();
    };
    browser.storage.onChanged.addListener(changed);
    return () => {
      browser.storage.onChanged.removeListener(changed);
      sequence.current++;
    };
  }, [load]);
  return { data, error, load };
}
