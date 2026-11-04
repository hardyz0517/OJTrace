// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { readLuoguPageProblemContextInPage } from "../../src/oj-enhancer/features/cross-oj-submit/luogu-page-context";
import {
  resolveLuoguProblem,
  sameLuoguPageDocumentUrl,
} from "../../src/oj-enhancer/features/cross-oj-submit/luogu-problem";

afterEach(() => document.body.replaceChildren());

describe("Luogu embedded problem context", () => {
  it("treats submit-panel fragment changes as the same page document", () => {
    expect(
      sameLuoguPageDocumentUrl(
        "https://www.luogu.com.cn/problem/CF1A",
        "https://www.luogu.com.cn/problem/CF1A#submit",
      ),
    ).toBe(true);
    expect(
      sameLuoguPageDocumentUrl(
        "https://www.luogu.com.cn/problem/CF1A#submit",
        "https://www.luogu.com.cn/problem/CF1B#submit",
      ),
    ).toBe(false);
    expect(
      sameLuoguPageDocumentUrl(
        "https://www.luogu.com.cn/problem/CF1A?pid=CF1A#submit",
        "https://www.luogu.com.cn/problem/CF1A?pid=CF1B#submit",
      ),
    ).toBe(false);
    expect(
      sameLuoguPageDocumentUrl(
        "https://evil.example/problem/CF1A",
        "https://www.luogu.com.cn/problem/CF1A#submit",
      ),
    ).toBe(false);
  });

  it("reads the original AtCoder task link needed for nonstandard Luogu IDs", () => {
    document.body.innerHTML = `
      <script id="lentille-context" type="application/json">
        {"data":{"problem":{"pid":"AT1202Contest_h","type":"AT","vjudge":{"id":"1202Contest_h","link":"https://atcoder.jp/contests/DEGwer2023/tasks/1202Contest_h"}}}}
      </script>`;

    expect(readLuoguPageProblemContextInPage()).toEqual({
      problemId: "AT1202Contest_h",
      type: "AT",
      atcoderOriginUrl:
        "https://atcoder.jp/contests/DEGwer2023/tasks/1202Contest_h",
    });

    expect(
      resolveLuoguProblem(
        "https://www.luogu.com.cn/problem/AT1202Contest_h#submit",
        readLuoguPageProblemContextInPage(),
      ),
    ).toMatchObject({
      problemId: "AT1202Contest_h",
      problem: {
        oj: "atcoder",
        contestId: "degwer2023",
        taskId: "1202contest_h",
      },
    });
  });

  it("rejects an embedded problem ID that conflicts with the current URL", () => {
    document.body.innerHTML = `
      <script id="lentille-context" type="application/json">
        {"data":{"problem":{"pid":"AT1202Contest_h","type":"AT","vjudge":{"link":"https://atcoder.jp/contests/DEGwer2023/tasks/1202Contest_h"}}}}
      </script>`;
    expect(
      resolveLuoguProblem(
        "https://www.luogu.com.cn/problem/AT1202Contest_g#submit",
        readLuoguPageProblemContextInPage(),
      ),
    ).toBeUndefined();
  });

  it("rejects malformed or incomplete embedded data", () => {
    document.body.innerHTML = `
      <script id="lentille-context" type="application/json">{broken</script>`;
    expect(readLuoguPageProblemContextInPage()).toBeUndefined();

    document.body.innerHTML = `
      <script id="lentille-context" type="application/json">
        {"data":{"problem":{"type":"AT"}}}
      </script>`;
    expect(readLuoguPageProblemContextInPage()).toBeUndefined();
  });
});
