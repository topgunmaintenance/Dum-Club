import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost";

export function Button({
  variant = "primary",
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
}) {
  const base =
    variant === "primary"
      ? "btn-primary"
      : "btn-ghost";
  return (
    <button {...rest} className={`${base} ${className}`}>
      {children}
    </button>
  );
}
