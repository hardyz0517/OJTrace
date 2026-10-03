import React from "react";
import type { SourceId } from "../../src/domain";
import { OJLogo } from "./OJLogo";

export function OJName({
  source,
  children,
  iconDataUrl,
  size = "tiny",
}: {
  source: SourceId;
  children: React.ReactNode;
  iconDataUrl?: string;
  size?: "tiny" | "small";
}) {
  return (
    <span className="oj-name">
      <OJLogo source={source} size={size} iconDataUrl={iconDataUrl} />
      <span>{children}</span>
    </span>
  );
}
