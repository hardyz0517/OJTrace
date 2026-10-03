import type { ComponentProps } from "react";

export function Input({ type = "text", ...props }: ComponentProps<"input">) {
  return <input type={type} {...props} />;
}
