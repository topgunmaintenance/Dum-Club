import { ReactNode } from "react";

type BadgeTone = "neutral" | "cyan" | "amber" | "rose" | "emerald";

const TONE: Record<BadgeTone, string> = {
  neutral:
    "border-white/10 bg-white/5 text-ink-200",
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function docTypeTone(type: string): BadgeTone {
  switch (type) {
    case "AMM":
    case "IPC":
      return "cyan";
    case "SB":
      return "amber";
    case "WORK_ORDER":
    case "LOGBOOK":
      return "emerald";
    case "TROUBLESHOOTING":
      return "rose";
    default:
      return "neutral";
  }
}

export function statusTone(status: string): BadgeTone {
  if (status === "indexed" || status === "healthy" || status === "ok")
    return "emerald";
  if (status === "processing" || status === "queued" || status === "degraded")
    return "amber";
  if (status === "failed" || status === "down") return "rose";
  return "neutral";
}
