import { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "cyan"
  | "amber"
  | "rose"
  | "emerald"
  | "violet";

const TONE: Record<BadgeTone, string> = {
  neutral: "border-white/[0.1] bg-white/[0.04] text-ink-200",
  cyan: "border-cyan-500/30 bg-cyan-500/[0.08] text-cyan-300",
  amber: "border-amber-500/30 bg-amber-500/[0.08] text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/[0.08] text-rose-300",
  emerald: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300",
  violet: "border-violet-500/30 bg-violet-500/[0.08] text-violet-300",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
  dot = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${TONE[tone]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function docTypeTone(type: string): BadgeTone {
  switch (type) {
    case "AMM":
      return "cyan";
    case "IPC":
      return "violet";
    case "SB":
      return "amber";
    case "WORK_ORDER":
      return "emerald";
    case "LOGBOOK":
      return "emerald";
    case "TROUBLESHOOTING":
      return "rose";
    case "PARTS_CATALOG":
      return "violet";
    case "INSPECTION_PROGRAM":
      return "cyan";
    default:
      return "neutral";
  }
}

export function statusTone(status: string): BadgeTone {
  if (status === "indexed" || status === "healthy" || status === "ok")
    return "emerald";
  if (
    status === "processing" ||
    status === "queued" ||
    status === "degraded" ||
    status === "watch"
  )
    return "amber";
  if (status === "failed" || status === "down") return "rose";
  return "neutral";
}
