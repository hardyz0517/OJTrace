# Third-party notices

OJTrace remains distributed under the MIT License. The following third-party materials are bundled for local PDF generation. No source code, layout template, CSS, or assets from the AGPL-licensed CNOI Statement Generator are copied into this project; its published PDF output is used only as a visual reference.

## Typst WASM renderer

`@myriaddreamin/typst-all-in-one.ts` version 0.7.0 is distributed under Apache License 2.0. The license text is included in [`public/licenses/typst-all-in-one-0.7.0-LICENSE.txt`](public/licenses/typst-all-in-one-0.7.0-LICENSE.txt) so it is also included in extension builds.

Upstream: https://github.com/Myriad-Dreamin/typst.ts

## TeX to Typst conversion

`tex2typst` version 0.6.2 is distributed under Apache License 2.0 and is used
only to convert common OJ math source into controlled Typst math. Its license is
included in [`public/licenses/tex2typst-0.6.2-LICENSE.txt`](public/licenses/tex2typst-0.6.2-LICENSE.txt).

Upstream: https://github.com/qwinsi/tex2typst

## Markdown parsing

`marked` version 18.1.0 is distributed under the MIT License and is used to
convert structured Luogu statement Markdown into inert HTML for the shared
statement extractor. The complete license is bundled at
[`public/licenses/marked-18.1.0-LICENSE.txt`](public/licenses/marked-18.1.0-LICENSE.txt);
no `marked` implementation files are copied into the extension source.

Upstream: https://github.com/markedjs/marked

## Fonts

The PDF renderer bundles unmodified fonts from the tagged Typst font asset repositories. Their upstream sources, applicable licenses, and full notices are documented in [`public/problem-fonts/README.md`](public/problem-fonts/README.md), [`public/problem-fonts/NOTICE-typst-assets.txt`](public/problem-fonts/NOTICE-typst-assets.txt), and [`public/problem-fonts/NOTICE-typst-dev-assets.txt`](public/problem-fonts/NOTICE-typst-dev-assets.txt).

`FiraMono-Regular.ttf` is from Google Fonts' Fira Mono family and is distributed
under the SIL Open Font License 1.1. The complete license text is included in
[`public/problem-fonts/OFL-FiraMono.txt`](public/problem-fonts/OFL-FiraMono.txt).

`FiraMono-Medium.ttf` and `FiraMono-Bold.ttf` are the matching weights from the same Fira Mono family and the same SIL Open Font License 1.1.

`lmroman10-regular.otf`, `lmroman10-bold.otf`, `lmroman12-regular.otf`, `lmroman12-bold.otf`, and `lmroman17-regular.otf` are Latin Modern Roman optical sizes from the GUST font project, under the GUST Font License (http://www.gust.org.pl/projects/e-foundry/licenses). `NewCMMath-Bold.otf` is the bold companion of the already bundled New Computer Modern Math face and uses the same upstream terms.

`SimSun.ttf` and `simhei.ttf` are proprietary Songti and Heiti faces bundled so the local renderer can match NOI statement metrics. They are not covered by the MIT license and are not open-font substitutes.


`OJTraceHei-Regular.otf` is a renamed subset of Noto Sans SC, used for section
headings. It remains under the SIL Open Font License 1.1. The license text is
included in [`public/problem-fonts/OFL-NotoSans.txt`](public/problem-fonts/OFL-NotoSans.txt).
The original Noto name is not used because the file is modified.

`OJTraceMincho-Regular.otf` is a renamed subset of Noto Serif CJK JP Regular, used as a fallback for Japanese kanji missing from the simplified-Chinese body font. It remains under the SIL Open Font License 1.1. The original Noto name is not used because the file is modified.

## CNOI visual reference

The final NOI/CNOI statement appearance is used only as an independent visual reference: https://github.com/Mr-Python-in-China/cnoi-statement-generator. No AGPL source files or its project-specific template/assets are redistributed by OJTrace.
