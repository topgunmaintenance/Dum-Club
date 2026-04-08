import { ReactNode } from "react";

export function Card({
  children,
  className = "",
  title,
  subtitle,
  action,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  variant?: "default" | "accent" | "elevated";
}) {
  const base =
    variant === "accent"
      ? "panel-accent"
      : variant === "elevated"
        ? "panel-elevated"
        : "panel";
  return (
    <section className={`${base} p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <h3 className="label-eyebrow text-ink-200">{title}</h3>
            )}
            {subtitle && (
              <p className="mt-1 text-[11.5px] leading-snug text-ink-400">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
