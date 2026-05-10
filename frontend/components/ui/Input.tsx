"use client";

/**
 * Input — labeled text input, design-system primitive.
 *
 * 44px field height (accessibility minimum), brand-teal focus ring,
 * surface-card background, default border that thickens on focus.
 *
 * Props:
 *   label    — required visible label, rendered above the input.
 *   helper   — neutral helper text below the field.
 *   error    — red error text below the field; takes precedence
 *              over helper when both are set, and toggles
 *              aria-invalid + a red border on the field.
 *   prefix   — element rendered inside the field on the left
 *              (e.g. a Lucide icon for a search input).
 *   suffix   — element rendered inside the field on the right.
 *
 * Accessibility:
 *   - The label uses a generated id linked via htmlFor.
 *   - Helper / error text get their own ids and are wired to the
 *     input via aria-describedby.
 *   - aria-invalid flips when an error string is present.
 */

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "prefix" | "size"
> & {
  label?: string;
  helper?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helper,
    error,
    prefix,
    suffix,
    id: idProp,
    className,
    containerClassName,
    "aria-describedby": describedBy,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const id = idProp ?? `dc-input-${reactId}`;
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedByValue =
    [describedBy, errorId, helperId].filter(Boolean).join(" ") || undefined;

  const fieldBorder = error
    ? "border-state-live focus:border-state-live focus:ring-[var(--state-live)]/30"
    : "border-default focus:border-brand-teal focus:ring-brand-teal/30";

  return (
    <div className={containerClassName ?? "w-full"}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1.5 block text-[12px] font-semibold text-primary"
        >
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {prefix && (
          <span className="pointer-events-none absolute left-3 text-secondary">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByValue}
          className={[
            "h-11 w-full rounded-xl bg-surface-card text-[14px] text-primary",
            "border focus:outline-none focus:ring-2",
            "placeholder:text-muted",
            "disabled:opacity-60 disabled:cursor-not-allowed",
            "transition-colors duration-150 ease-out motion-reduce:transition-none",
            fieldBorder,
            prefix ? "pl-10" : "pl-3.5",
            suffix ? "pr-10" : "pr-3.5",
            className ?? "",
          ]
            .filter(Boolean)
            .join(" ")}
          {...rest}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 text-secondary">
            {suffix}
          </span>
        )}
      </div>
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 text-[12px] font-medium text-state-live"
        >
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="mt-1.5 text-[12px] text-secondary">
          {helper}
        </p>
      ) : null}
    </div>
  );
});
