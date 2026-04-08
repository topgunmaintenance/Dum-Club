export function SparkBar({
  value,
  max,
  tone = "cyan",
}: {
  value: number;
  max: number;
  tone?: "cyan" | "amber" | "emerald" | "rose";
}) {
  const pct = Math.min(100, Math.max(0, (value / Math.max(max, 1)) * 100));
  const color =
    tone === "amber"
      ? "from-amber-400 to-amber-500"
      : tone === "emerald"
        ? "from-emerald-400 to-emerald-500"
        : tone === "rose"
          ? "from-rose-400 to-rose-500"
          : "from-cyan-400 to-cyan-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
      <div
        className={`h-full bg-gradient-to-r ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
