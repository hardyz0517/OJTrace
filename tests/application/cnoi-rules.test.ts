import { describe, it, expect, vi } from "vitest";
import {
  createStoragePort,
  defaultStoredData,
} from "../../src/application/storage/store";
import { memoryStorageArea } from "../helpers/memory-storage";
import {
  readRulesState,
  saveRules,
  handleRulesMessage,
} from "../../src/application/cnoi-rules/service";
import { convertSourceToCnoi } from "../../src/problem/cnoi/convert";
import {
  isRulesMessage,
  isRulesResponse,
} from "../../src/application/cnoi-rules/messages";
import type { SourceId } from "../../src/domain/types";

describe("CNOI rules application and persistence", () => {
  it("keeps five sources independent across refresh, preserves concurrent unrelated preferences and resets sparsely", async () => {
    const area = memoryStorageArea(),
      storage = createStoragePort(area);
    const sources: SourceId[] = [
      "luogu",
      "codeforces",
      "atcoder",
      "qoj",
      "hydroj",
    ];
    await Promise.all([
      ...sources.map((source, i) =>
        saveRules(storage, source, { sectionLevel: i + 1 }, null),
      ),
      storage.transact((data) => ({
        ...data,
        preferences: {
          ...data.preferences,
          syncAccountIds: [],
          paginationBySource: { qoj: { intervalMs: 2000, jitterMs: 0 } },
        },
      })),
    ]);
    const refreshed = createStoragePort(area);
    for (const [i, source] of sources.entries()) {
      const state = await readRulesState(refreshed, source);
      expect(state.entry?.overrides.sectionLevel ?? 2).toBe(i + 1);
    }
    const state = await readRulesState(refreshed, "qoj");
    await saveRules(refreshed, "qoj", {}, state.entry);
    expect(
      (await storage.load()).preferences.cnoiRules?.bySource.qoj,
    ).toBeUndefined();
    expect(
      (await storage.load()).preferences.paginationBySource?.qoj?.intervalMs,
    ).toBe(2000);
    expect((await storage.load()).preferences.syncAccountIds).toEqual([]);
  });
  it("rejects stale same-source saves and invalid rules without losing drafts or data", async () => {
    const storage = createStoragePort(memoryStorageArea());
    await saveRules(storage, "codeforces", { sectionLevel: 3 }, null);
    await expect(
      saveRules(storage, "codeforces", { sectionLevel: 4 }, null),
    ).rejects.toThrow("其他页面");
    await expect(
      saveRules(storage, "qoj", { sectionLevel: 9 }, null),
    ).rejects.toThrow("配置有误");
    expect(
      (await readRulesState(storage, "codeforces")).entry?.overrides
        .sectionLevel,
    ).toBe(3);
  });
  it("isolates corrupt or future-version entries and keeps valid accounts/settings", async () => {
    const area = memoryStorageArea({
      "ojtrace:data": {
        ...defaultStoredData(),
        preferences: {
          ...defaultStoredData().preferences,
          cnoiRules: {
            formatVersion: 1,
            bySource: {
              luogu: { defaultsVersion: 1, overrides: { sectionLevel: 3 } },
              qoj: { defaultsVersion: 9, overrides: { sectionLevel: 4 } },
            },
          },
        },
      },
    });
    const storage = createStoragePort(area);
    expect(
      (await readRulesState(storage, "qoj")).issues.length,
    ).toBeGreaterThan(0);
    expect(
      (await readRulesState(storage, "luogu")).entry?.overrides.sectionLevel,
    ).toBe(3);
    await saveRules(storage, "qoj", {}, null);
    expect((await readRulesState(storage, "qoj")).issues).toEqual([]);
  });
  it("uses the real conversion entry for draft preview and never persists preview", async () => {
    const area = memoryStorageArea();
    const set = vi.spyOn(area, "set");
    const storage = createStoragePort(area);
    const source = {
      metadata: {
        oj: "codeforces" as const,
        problemId: "1A",
        title: "A+B",
        originalUrl: "https://codeforces.com/problemset/problem/1/A",
        language: "en" as const,
      },
      sourceMarkdown: "## Examples\n\n### Input\n\n```\n1\n```\n",
      assets: [],
      warnings: [],
    };
    const overrides = { sectionLevel: 3 };
    const preview = await handleRulesMessage(storage, {
      type: "PREVIEW_CNOI_CONVERSION",
      schemaVersion: 1,
      requestId: "preview",
      source: "codeforces",
      metadata: source.metadata,
      markdown: source.sourceMarkdown,
      overrides,
    });
    const formal = convertSourceToCnoi(source, overrides);
    expect(
      preview.ok && preview.type === "CNOI_PREVIEW" && preview.markdown,
    ).toBe(formal.ok && formal.value.cnoiMarkdown);
    expect(set).not.toHaveBeenCalled();
    expect(isRulesResponse(preview)).toBe(true);
  });
  it("validates message and catalog responses at the transport boundary", async () => {
    const state = await readRulesState(
      createStoragePort(memoryStorageArea()),
      "atcoder",
    );
    expect(
      isRulesResponse({
        schemaVersion: 1,
        requestId: "a",
        ok: true,
        type: "CNOI_RULES",
        state,
      }),
    ).toBe(true);
    expect(
      isRulesMessage({
        schemaVersion: 1,
        requestId: "a",
        type: "UPDATE_CNOI_RULES",
        source: "qoj",
        expected: null,
        overrides: { eval: "x" },
      }),
    ).toBe(false);
  });
});
