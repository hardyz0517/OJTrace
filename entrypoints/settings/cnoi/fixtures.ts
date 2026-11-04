import luogu from "./fixtures/luogu-fields.md?raw";
import p5665 from "./fixtures/luogu-p5665.md?raw";
import theatreSquare from "./fixtures/codeforces-1a.md?raw";
import codeforces from "./fixtures/codeforces-context.md?raw";
import atcoder from "./fixtures/atcoder-ja.md?raw";
import atcoderEn from "./fixtures/atcoder-en.md?raw";
import qoj from "./fixtures/qoj-wrapper.md?raw";
import qoj1907 from "./fixtures/qoj-1907.md?raw";
import hydrojTree from "./fixtures/hydroj-tree.md?raw";
import hydroj from "./fixtures/hydroj-chinese.md?raw";
import type { SourceId } from "../../../src/domain/types";
import type { ProblemMetadata } from "../../../src/problem/domain";
export interface PreviewFixture {
  id: string;
  name: string;
  markdown: string;
  metadata: ProblemMetadata;
}
const fixture = (
  oj: SourceId,
  id: string,
  name: string,
  markdown: string,
  language: "zh" | "en" | "ja",
  title = "Fixture",
  originalUrl = "https://example.org/p/1",
): PreviewFixture => ({
  id,
  name,
  markdown,
  metadata: { oj, problemId: id, title, language, originalUrl },
});
export const previewFixtures: Record<SourceId, PreviewFixture[]> = {
  luogu: [
    fixture("luogu", "fields", "原生章节与样例包装", luogu, "en"),
    fixture(
      "luogu",
      "P5665",
      "P5665 · 多组样例与表格",
      p5665,
      "zh",
      "[CSP-S 2019] 划分",
      "https://www.luogu.com.cn/problem/P5665",
    ),
  ],
  codeforces: [
    fixture(
      "codeforces",
      "1A",
      "1A · Theatre Square（英文存档）",
      theatreSquare,
      "en",
      "Theatre Square",
      "https://codeforces.com/problemset/problem/1/A",
    ),
    fixture(
      "codeforces",
      "context",
      "Input 与 Examples 上下文",
      codeforces,
      "en",
    ),
  ],
  atcoder: [
    fixture("atcoder", "japanese", "日文章节与样例", atcoder, "ja"),
    fixture(
      "atcoder",
      "abc391_g",
      "ABC391 G · 英文与公式",
      atcoderEn,
      "en",
      "Many LCS",
      "https://atcoder.jp/contests/abc391/tasks/abc391_g",
    ),
  ],
  qoj: [
    fixture("qoj", "wrapper", "样例包装与正文保留", qoj, "en"),
    fixture(
      "qoj",
      "1907",
      "QOJ 1907 · 样例与附件说明",
      qoj1907,
      "zh",
      "Fixture",
      "https://qoj.ac/problem/1907",
    ),
  ],
  hydroj: [
    fixture("hydroj", "chinese", "中文说明与测试样例", hydroj, "zh"),
    fixture(
      "hydroj",
      "tree",
      "生成树很爽 · 完整题面",
      hydrojTree,
      "zh",
      "生成树很爽（tree）",
    ),
  ],
};
