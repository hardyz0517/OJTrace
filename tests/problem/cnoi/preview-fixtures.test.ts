import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { previewFixtures } from "../../../entrypoints/settings/cnoi/fixtures";
import { convertSourceToCnoi } from "../../../src/problem/cnoi/convert";
describe("bundled Source fixtures", () => {
  it("retains exact captured Source bytes and exercises every site's actual converter", () => {
    for (const [bundled, original] of [
      ["luogu-p5665", "luogu-p5665.source.md"],
      ["atcoder-en", "atcoder-abc391-g.en.source.md"],
      ["qoj-1907", "qoj-1907.source.md"],
      ["hydroj-tree", "hydroj-tree.source.md"],
    ])
      expect(
        readFileSync(
          `entrypoints/settings/cnoi/fixtures/${bundled}.md`,
          "utf8",
        ),
      ).toBe(readFileSync(`tests/problem/fixtures/${original}`, "utf8"));
    for (const fixtures of Object.values(previewFixtures))
      for (const fixture of fixtures) {
        const result = convertSourceToCnoi(
          {
            sourceMarkdown: fixture.markdown,
            metadata: fixture.metadata,
            assets: [],
            warnings: [],
          },
          { sectionLevel: 3 },
        );
        expect(result.ok, fixture.name).toBe(true);
      }
  });
});
