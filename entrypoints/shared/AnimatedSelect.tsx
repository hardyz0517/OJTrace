import React, { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import "./AnimatedSelect.css";

export interface SelectOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
}

export function AnimatedSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  variant = "form",
  portal = false,
  id,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  variant?: "form" | "compact";
  /** Escape scroll containers and collapsed groups without clipping the menu. */
  portal?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    setActiveIndex(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    setActiveIndex(index);
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      setActiveIndex(
        (index) => (index + delta + options.length) % options.length,
      );
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else setOpen(true);
    }
  }

  const menu = (
    <div
      ref={menuRef}
      id={listId}
      className={`select-menu${open ? " is-open" : ""}`}
      role="listbox"
      aria-label={label}
      aria-hidden={!open}
    >
      {options.map((option, index) => (
        <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          tabIndex={open ? 0 : -1}
          className={`select-option${option.value === value ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
          key={String(option.value)}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(index)}
        >
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
  const trigger = (
    <button
      id={id}
      ref={triggerRef}
      type="button"
      className={`select-trigger${open ? " is-open" : ""}`}
      aria-label={label}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      onClick={() => {
        if (!portal) setOpen((current) => !current);
      }}
      onKeyDown={onKeyDown}
    >
      <span>{selected?.label}</span>
      <span className="select-chevron" aria-hidden="true" />
    </button>
  );
  const control = (
    <div
      className={`animated-select animated-select--${variant}`}
      ref={rootRef}
    >
      {portal ? <Popover.Trigger asChild>{trigger}</Popover.Trigger> : trigger}
      {!portal && menu}
    </div>
  );
  if (!portal) return control;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {control}
      <Popover.Portal>
        <Popover.Content
          asChild
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div
            className={`animated-select animated-select--${variant} animated-select-portal`}
            aria-hidden={!open}
            inert={!open}
          >
            {menu}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
