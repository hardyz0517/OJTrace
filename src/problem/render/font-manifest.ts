/** Packaged font files. Style tokens name families; they do not name files. */
export const bundledFonts = [
  {
    path: "/problem-fonts/lmroman10-regular.otf",
    family: "Latin Modern Roman",
  },
  { path: "/problem-fonts/lmroman10-bold.otf", family: "Latin Modern Roman" },
  { path: "/problem-fonts/lmroman10-italic.otf", family: "Latin Modern Roman" },
  {
    path: "/problem-fonts/lmroman10-bolditalic.otf",
    family: "Latin Modern Roman",
  },
  {
    path: "/problem-fonts/lmroman12-regular.otf",
    family: "Latin Modern Roman 12",
  },
  {
    path: "/problem-fonts/lmroman12-bold.otf",
    family: "Latin Modern Roman 12",
  },
  {
    path: "/problem-fonts/lmroman12-italic.otf",
    family: "Latin Modern Roman 12",
  },
  {
    path: "/problem-fonts/lmroman17-regular.otf",
    family: "Latin Modern Roman 17",
  },
  { path: "/problem-fonts/SimSun.ttf", family: "SimSun" },
  { path: "/problem-fonts/simhei.ttf", family: "SimHei" },
  { path: "/problem-fonts/FiraMono-Regular.ttf", family: "Fira Mono" },
  { path: "/problem-fonts/FiraMono-Medium.ttf", family: "Fira Mono" },
  { path: "/problem-fonts/FiraMono-Bold.ttf", family: "Fira Mono" },
  {
    path: "/problem-fonts/NewCMMath-Book.otf",
    family: "New Computer Modern Math",
  },
  {
    path: "/problem-fonts/NewCMMath-Regular.otf",
    family: "New Computer Modern Math",
  },
  {
    path: "/problem-fonts/NewCMMath-Bold.otf",
    family: "New Computer Modern Math",
  },
  {
    path: "/problem-fonts/NotoSerifCJKsc-Regular.otf",
    family: "Noto Serif CJK SC",
  },
  {
    path: "/problem-fonts/NotoSerifCJKsc-Bold.otf",
    family: "Noto Serif CJK SC",
  },
  {
    path: "/problem-fonts/OJTraceMincho-Regular.otf",
    family: "OJTrace Mincho",
  },
  { path: "/problem-fonts/OJTraceHei-Regular.otf", family: "OJTrace Hei" },
] as const;

export const bundledFontPaths: readonly string[] = bundledFonts.map(
  (font) => font.path,
);
