// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isCrossOjMessage } from "../../src/oj-enhancer/features/cross-oj-submit/model";
import {
  buildLuoguCrossOjRecordUrl,
  ensureCodeforcesTestDetailsExpanded,
  parseAtCoderSubmissionDetail,
  parseCodeforcesSubmissionDetail,
  readLuoguCrossOjRecordRoute,
  readCrossOjSubmissionDetail,
  safeLuoguReturnUrl,
} from "../../src/oj-enhancer/features/cross-oj-submit/record-details";

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document.body, "innerText");
});

function renderSubmissionPage(): void {
  document.body.innerHTML = `
    <div id="pageContent">
      <table>
        <thead><tr><th>#</th><th>Author</th><th>Problem</th><th>Lang</th><th>Verdict</th><th>Time</th><th>Memory</th><th>Sent</th><th>Judged</th></tr></thead>
        <tbody><tr>
          <td>397309600</td>
          <td><a href="/profile/HardyZ">HardyZ</a></td>
          <td><a title="A - Theatre Square" href="/contest/1/problem/A">1A</a></td>
          <td>GNU C++17</td><td>Accepted</td><td>31 ms</td><td>84 KB</td>
          <td>2026-11-04 11:39:39</td><td>2026-11-04 11:39:40</td>
        </tr></tbody>
      </table>
      <section><h3>→ Source</h3><pre id="program-source-text">#include &lt;iostream&gt;\nint main() { return 0; }</pre></section>
      <a href="#">Click here to see test details</a>
      <h3>→ Judgement Protocol</h3>
      <div class="test-case">1<br>Time: 15 ms, memory: 16 KB<br>Verdict: OK<br>Input<br>6 6 4<br>Participant's output<br>4<br>Jury's answer<br>4<br>Checker comment<br>ok 1 number(s): "4"</div>
      <div class="test-case">2<br>Time: 0 ms, memory: 0 KB<br>Verdict: OK<br>Input<br>1 1 1<br>Participant's output<br>1<br>Jury's answer<br>1<br>Checker comment<br>ok 1 number(s): "1"</div>
    </div>`;
  Object.defineProperty(document.body, "innerText", {
    configurable: true,
    value: `
General
#\tAuthor\tProblem\tLang\tVerdict\tTime\tMemory\tSent\tJudged
397309600\tHardyZ\t1A - 10\tGNU C++17\tAccepted\t31 ms\t84 KB\t2026-11-04 11:39:39\t2026-11-04 11:39:40
→ Source
#include <iostream>
int main() { return 0; }
Click here to see test details
→ Judgement Protocol
1
Time: 15 ms, memory: 16 KB
Verdict: OK
Input
6 6 4
Participant's output
4
Jury's answer
4
Checker comment
ok 1 number(s): "4"
2
Time: 0 ms, memory: 0 KB
Verdict: OK
Input
1 1 1
Participant's output
1
Jury's answer
1
Checker comment
ok 1 number(s): "1"`,
  });
}

describe("Codeforces submission detail parsing", () => {
  it("extracts the summary, source and full per-test protocol", () => {
    renderSubmissionPage();
    const detail = parseCodeforcesSubmissionDetail(
      document,
      "https://codeforces.com/contest/1/submission/397309600",
      123,
    );
    expect(detail).toMatchObject({
      oj: "codeforces",
      submissionId: "397309600",
      problemId: "1/A",
      problemName: "A - Theatre Square",
      username: "HardyZ",
      language: "GNU C++17",
      evaluationStatus: "accepted",
      timeMs: 31,
      memoryBytes: 84 * 1024,
      passedTestCount: 2,
      sourceCode: "#include <iostream>\nint main() { return 0; }",
      tests: [
        {
          index: 1,
          verdict: "OK",
          timeMs: 15,
          memoryBytes: 16 * 1024,
          input: "6 6 4",
          output: "4",
          answer: "4",
          checkerLog: 'ok 1 number(s): "4"',
        },
        { index: 2, input: "1 1 1", output: "1", answer: "1" },
      ],
      truncated: false,
    });
  });

  it("refuses mismatched or non-Codeforces record routes", () => {
    renderSubmissionPage();
    expect(
      parseCodeforcesSubmissionDetail(
        document,
        "https://codeforces.com/contest/1/submission/123",
      ),
    ).toBeUndefined();
    expect(
      parseCodeforcesSubmissionDetail(
        document,
        "https://codeforces.com.evil.example/contest/1/submission/397309600",
      ),
    ).toBeUndefined();
  });

  it("bounds large captured source files and marks the snapshot as truncated", () => {
    renderSubmissionPage();
    const source = document.querySelector("#program-source-text");
    if (!source) throw new Error("source fixture missing");
    source.textContent = "x".repeat(130_001);
    const detail = parseCodeforcesSubmissionDetail(
      document,
      "https://codeforces.com/contest/1/submission/397309600",
      123,
    );
    expect(detail?.sourceCode).toHaveLength(120_000);
    expect(detail?.truncated).toBe(true);
  });

  it("builds and validates Luogu-native record routes", () => {
    const codeforcesUrl = buildLuoguCrossOjRecordUrl(
      "codeforces",
      "1",
      "397309600",
      "1/A",
    );
    expect(codeforcesUrl).toBe(
      "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/397309600",
    );
    expect(readLuoguCrossOjRecordRoute(codeforcesUrl!)).toEqual({
      oj: "codeforces",
      contestId: "1",
      submissionId: "397309600",
      problemId: "CF1A",
    });
    const atcoderUrl = buildLuoguCrossOjRecordUrl(
      "atcoder",
      "abc175",
      "123456789",
      "abc175_f",
    );
    expect(atcoderUrl).toBe(
      "https://www.luogu.com.cn/record/list?pid=AT_abc175_f#ojtrace-record=at/123456789",
    );
    expect(readLuoguCrossOjRecordRoute(atcoderUrl!)).toEqual({
      oj: "atcoder",
      contestId: "abc175",
      submissionId: "123456789",
      problemId: "AT_abc175_f",
    });
    expect(
      readLuoguCrossOjRecordRoute(
        "https://www.luogu.com.cn.evil.example/record/cf/1/397309600",
      ),
    ).toBeUndefined();
    expect(
      readLuoguCrossOjRecordRoute(
        "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/2/397309600",
      ),
    ).toBeUndefined();
    expect(
      readLuoguCrossOjRecordRoute(
        "https://www.luogu.com.cn/record/list?pid=AT_abc175_f#ojtrace-record=at/abc176/123456789",
      ),
    ).toBeUndefined();
    // Previously generated links remain readable, but new links omit contestId.
    expect(
      readLuoguCrossOjRecordRoute(
        "https://www.luogu.com.cn/record/list?pid=CF1A#ojtrace-record=cf/1/397309600",
      )?.submissionId,
    ).toBe("397309600");
    expect(
      buildLuoguCrossOjRecordUrl("codeforces", "../1", "12", "1/A"),
    ).toBeUndefined();
    expect(safeLuoguReturnUrl("https://evil.example/")).toBeUndefined();
    expect(
      safeLuoguReturnUrl("https://www.luogu.com.cn/problem/CF1A#submit"),
    ).toBe("https://www.luogu.com.cn/problem/CF1A#submit");
    expect(
      isCrossOjMessage({
        schemaVersion: 1,
        requestId: "request",
        type: "GET_CROSS_OJ_DETAIL",
        submissionId: "397309600",
        oj: "codeforces",
      }),
    ).toBe(true);
    expect(
      isCrossOjMessage({
        schemaVersion: 1,
        requestId: "request",
        type: "GET_CROSS_OJ_DETAIL",
        submissionId: "397309600",
        oj: "other",
      }),
    ).toBe(false);

    renderSubmissionPage();
    const detail = parseCodeforcesSubmissionDetail(
      document,
      "https://codeforces.com/contest/1/submission/397309600",
      123,
    )!;
    expect(readCrossOjSubmissionDetail(detail)).toMatchObject({
      submissionId: "397309600",
      detailUrl: "https://codeforces.com/contest/1/submission/397309600",
    });
    expect(
      readCrossOjSubmissionDetail({
        ...detail,
        detailUrl: "https://evil.example/",
      }),
    ).toBeUndefined();
  });
  it("parses AtCoder source, verdict, resource usage and case rows", () => {
    document.body.innerHTML = `
      <a href="/contests/abc175/tasks/abc175_f">F - Making Palindrome</a>
      <table class="table-bordered"><tbody>
        <tr><th>User</th><td>Hardy</td></tr>
        <tr><th>Language</th><td>C++ 17</td></tr>
        <tr><th>Submission Time</th><td>2026-11-05 12:59:12+0900</td></tr>
        <tr><th>Status</th><td>AC</td></tr>
        <tr><th>Exec Time</th><td>18 ms</td></tr>
        <tr><th>Memory</th><td>64 KiB</td></tr>
        <tr><th>Score</th><td>600</td></tr>
      </tbody></table>
      <pre id="submission-code">int main() { return 0; }</pre>
      <table class="table-bordered">
        <thead><tr><th>Case Name</th><th>Status</th><th>Time</th><th>Memory</th></tr></thead>
        <tbody><tr><td>Sample 1</td><td>AC</td><td>1 ms</td><td>8 KiB</td></tr></tbody>
      </table>`;
    const detail = parseAtCoderSubmissionDetail(
      document,
      "https://atcoder.jp/contests/abc175/submissions/123456789",
      456,
    );
    expect(detail).toMatchObject({
      oj: "atcoder",
      submissionId: "123456789",
      problemId: "abc175_f",
      problemName: "F - Making Palindrome",
      username: "Hardy",
      language: "C++ 17",
      evaluationStatus: "accepted",
      rawVerdict: "AC",
      timeMs: 18,
      memoryBytes: 64 * 1024,
      score: 600,
      sourceCode: "int main() { return 0; }",
      tests: [{ index: 1, verdict: "AC", timeMs: 1, memoryBytes: 8 * 1024 }],
    });
  });
  it("opens Codeforces' split-link test details expander before parsing", async () => {
    document.body.innerHTML = `<div><a href="#" id="details">Click</a> to see test details</div>`;
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value: "Click to see test details",
    });
    document.querySelector("#details")?.addEventListener("click", (event) => {
      event.preventDefault();
      Object.defineProperty(document.body, "innerText", {
        configurable: true,
        value:
          "Judgement Protocol\n1\nTime: 15 ms, memory: 0 KB\nVerdict: OK\nInput\n1\nParticipant's output\n1\nJury's answer\n1",
      });
    });

    await ensureCodeforcesTestDetailsExpanded(document, 300);

    expect(document.body.innerText).toContain("Judgement Protocol");
  });
});
