# Bundled PDF fonts

These fonts are loaded by the browser-local Typst renderer. They are kept as
separate extension assets so the renderer does not depend on a remote font
registry.

| File | Upstream source | License |
| --- | --- | --- |
| `NotoSerifCJKsc-Regular.otf`, `NotoSerifCJKsc-Bold.otf` | [typst-dev-assets v0.13.1](https://github.com/typst/typst-dev-assets/tree/v0.13.1/files/fonts) | SIL Open Font License 1.1 |
| `NewCMMath-Regular.otf`, `NewCMMath-Bold.otf`, `NewCM10-Regular.otf` | [typst-assets v0.13.1](https://github.com/typst/typst-assets/tree/v0.13.1/files/fonts) | GUST Font License / LPPL terms stated by upstream |
| `FiraMono-Regular.ttf`, `FiraMono-Medium.ttf`, `FiraMono-Bold.ttf` | [Google Fonts Fira Mono](https://github.com/google/fonts/tree/main/ofl/firamono) | SIL Open Font License 1.1 |
| `LibertinusSerif-Regular.otf`, `LibertinusSerif-Italic.otf`, `LibertinusSerif-Bold.otf`, `LibertinusSerif-BoldItalic.otf` | [typst-assets v0.13.1](https://github.com/typst/typst-assets/tree/v0.13.1/files/fonts) | SIL Open Font License 1.1 |
| `lmroman10-regular.otf`, `lmroman10-bold.otf`, `lmroman10-italic.otf`, `lmroman10-bolditalic.otf`, `lmroman12-regular.otf`, `lmroman12-bold.otf`, `lmroman12-italic.otf`, `lmroman17-regular.otf` | [Latin Modern](https://www.gust.org.pl/projects/e-foundry/latin-modern) | GUST Font License |
| `NewCMMath-Book.otf` | [typst-assets v0.13.1](https://github.com/typst/typst-assets/tree/v0.13.1/files/fonts) | GUST Font License / LPPL terms stated by upstream |
| `SimSun.ttf`, `simhei.ttf` | Proprietary Songti / Heiti faces | Not open source; local rendering only |
| `OJTraceHei-Regular.otf` | Subset of [Noto Sans SC](https://github.com/notofonts/noto-cjk/tree/main/Sans/SubsetOTF/SC) Regular, renamed because the file is modified | SIL Open Font License 1.1 |
| `OJTraceMincho-Regular.otf` | Subset of [Noto Serif CJK JP](https://github.com/notofonts/noto-cjk/tree/main/Serif/SubsetOTF/JP) Regular, renamed because the file is modified | SIL Open Font License 1.1 |

The complete upstream notices are preserved in
[`NOTICE-typst-assets.txt`](./NOTICE-typst-assets.txt) and
[`NOTICE-typst-dev-assets.txt`](./NOTICE-typst-dev-assets.txt). The open fonts are unmodified copies of their upstream files, except
`OJTraceHei-Regular.otf` and `OJTraceMincho-Regular.otf`. `SimSun.ttf` and
`simhei.ttf` are proprietary and are bundled only so Chinese text matches
NOI Songti and Heiti metrics.

`OJTraceHei-Regular.otf` is a subset of Noto Sans SC Regular, limited to the
character set already shipped in `NotoSerifCJKsc-Regular.otf` plus common
Latin and punctuation. Noto is a reserved font name, so this modified file
uses the family name `OJTrace Hei`. Its license is
[`OFL-NotoSans.txt`](./OFL-NotoSans.txt). It remains a fallback for glyphs missing from the bundled Heiti face.


`OJTraceMincho-Regular.otf` is a subset of Noto Serif CJK JP Regular. It keeps
only glyphs that are absent from the bundled `NotoSerifCJKsc-Regular.otf`, so
Japanese shinjitai such as 橋 and 構 are not dropped when the statement
font falls through from the simplified-Chinese subset. Noto is a reserved font
name, so this modified file uses the family name `OJTrace Mincho`. Its license
is the SIL Open Font License 1.1 in [`OFL-NotoSans.txt`](./OFL-NotoSans.txt).
