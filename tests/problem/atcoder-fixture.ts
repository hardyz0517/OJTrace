import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

/** Reproduce the two Copy controls inserted by AtCoder's public contest.js. */
export function atcoderFixture(options: {
  language: "en" | "ja";
  rendered?: boolean;
  copyControls?: boolean;
}): string {
  const dom = new JSDOM(
    readFileSync("docs/fixtures/problem/atcoder-abc391-g.html", "utf8"),
  );
  const document = dom.window.document;
  for (const language of ["en", "ja"]) {
    document.querySelector<HTMLElement>(`.lang-${language}`)!.style.display =
      language === options.language ? "inline" : "none";
  }
  if (options.rendered) {
    for (const variable of document.querySelectorAll("var")) {
      const tex = variable.textContent ?? "";
      const span = document.createElement("span");
      span.className = "katex";
      span.innerHTML =
        '<span class="katex-mathml"><math><semantics><mrow>rendered glyphs</mrow><annotation encoding="application/x-tex"></annotation></semantics></math></span><span class="katex-html" aria-hidden="true">duplicated visual glyphs</span>';
      span.querySelector("annotation")!.textContent = tex;
      variable.replaceChildren(span);
    }
  }
  if (options.copyControls) {
    for (const [index, pre] of [
      ...document.querySelectorAll("#task-statement h3+pre"),
    ].entries()) {
      const id = `pre-sample${index}`;
      pre.id = id;
      const control = document.createElement("span");
      control.className = "btn btn-default btn-sm btn-copy ml-1";
      control.dataset.target = id;
      control.textContent = "Copy";
      pre.previousElementSibling!.append(control);
      const wrapper = document.createElement("div");
      wrapper.className = "div-btn-copy";
      wrapper.innerHTML = `<span class="btn-copy btn-pre" data-target="${id}">Copy</span>`;
      pre.before(wrapper);
    }
  }
  const html = document.documentElement.outerHTML;
  dom.window.close();
  return html;
}
