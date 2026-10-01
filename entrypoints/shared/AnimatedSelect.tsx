import React, { useEffect, useId, useRef, useState } from "react";

export interface SelectOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
}

export function AnimatedSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="animated-select" ref={rootRef}>
      <button
        type="button"
        className={`select-trigger${open ? " is-open" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label}</span>
        <span className="select-chevron" aria-hidden="true" />
      </button>
      <div
        id={listId}
        className={`select-menu${open ? " is-open" : ""}`}
        role="listbox"
        aria-label={label}
        aria-hidden={!open}
      >
        {options.map((option) => (
          <button
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={`select-option${option.value === value ? " is-selected" : ""}`}
            key={String(option.value)}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
          >
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
