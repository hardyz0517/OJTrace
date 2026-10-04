import { useEffect, useState } from "react";
import type { SourceId } from "../../src/domain";
import "./OJLogo.css";

const logoFiles: Record<SourceId, string> = {
  codeforces: "/oj-logos/codeforces.png",
  luogu: "/oj-logos/luogu.svg",
  qoj: "/oj-logos/qoj.png",
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
  return (
    <img
      className={`oj-logo oj-logo-${size}`}
      src={failed ? logoFiles[source] : (iconDataUrl ?? logoFiles[source])}
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
