import { ReactNode } from "react";

export function EmptyState({
  glyph = "◌",
  title,
  body,
  action,
}: {
  glyph?: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-gunmetal-900/40 px-6 py-10 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-lg text-ink-300">
        {glyph}
      </div>
      <div className="text-[13px] font-semibold text-ink-100">{title}</div>
      <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-ink-400">
        {body}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
