import React, { useEffect, useState } from "react";
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
  iconDataUrl,
  onError,
}: {
  source: SourceId;
  size?: "tiny" | "small";
  iconDataUrl?: string;
  onError?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [iconDataUrl, source]);
  if (source === "qoj") {
    return (
      <svg
        className={`oj-logo oj-logo-qoj oj-logo-${size}`}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <title>{`${sourceNames[source]} logo`}</title>
        <circle cx="12" cy="12" r="9.25" />
        <path d="M2.75 12h18.5" />
        <path d="M12 2.75c2.4 2.45 3.65 5.6 3.65 9.25S14.4 18.8 12 21.25" />
        <path d="M12 2.75c-2.4 2.45-3.65 5.6-3.65 9.25S9.6 18.8 12 21.25" />
        <path d="M4.25 7.6h15.5M4.25 16.4h15.5" />
      </svg>
    );
  }

  return (
    <img
      className={`oj-logo oj-logo-${size}`}
      src={failed ? logoFiles[source]! : (iconDataUrl ?? logoFiles[source]!)}
      alt=""
      aria-hidden="true"
      title={`${sourceNames[source]} logo`}
      onError={
        iconDataUrl
          ? () => {
              setFailed(true);
              onError?.();
            }
          : undefined
      }
    />
  );
}
