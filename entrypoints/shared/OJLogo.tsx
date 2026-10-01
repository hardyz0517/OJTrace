import React from "react";
import type { SourceId } from "../../src/domain";
import "./OJLogo.css";

const logoFiles: Partial<Record<SourceId, string>> = {
  codeforces: "/oj-logos/codeforces.png",
  luogu: "/oj-logos/luogu.svg",
  atcoder: "/oj-logos/atcoder-favicon.png",
  hydroj: "/oj-logos/hydroj.png",
};

const sourceNames: Record<SourceId, string> = {
  codeforces: "Codeforces",
  luogu: "洛谷",
  qoj: "QOJ",
  atcoder: "AtCoder",
  hydroj: "HydroOJ",
};

export function OJLogo({
  source,
  size = "small",
}: {
  source: SourceId;
  size?: "tiny" | "small";
}) {
  if (source === "qoj") {
    return (
      <span
        className={`oj-logo oj-logo-qoj oj-logo-${size}`}
        aria-hidden="true"
        title={`${sourceNames[source]} logo`}
      />
    );
  }

  return (
    <img
      className={`oj-logo oj-logo-${size}`}
      src={logoFiles[source]!}
      alt=""
      aria-hidden="true"
      title={`${sourceNames[source]} logo`}
    />
  );
}
