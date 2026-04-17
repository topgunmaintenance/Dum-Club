/**
 * Loading skeleton for /discover — shown during route transition.
 */

export default function DiscoverLoading() {
  return (
    <main className="relative min-h-screen bg-[#060606] text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Hero skeleton */}
        <div className="mb-8">
          <div className="mb-3 h-3 w-48 animate-pulse rounded bg-zinc-800/50" />
          <div className="mb-3 h-10 w-3/4 animate-pulse rounded bg-zinc-800/50" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-zinc-800/50" />
        </div>

        {/* Trust strip skeleton */}
        <div className="mb-6 h-12 animate-pulse rounded-xl bg-zinc-800/30" />

        {/* Filter bar skeleton */}
        <div className="mb-6 h-20 animate-pulse rounded-xl bg-zinc-800/30" />

        {/* Grid skeleton */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-zinc-800/50 bg-zinc-950/60 p-5">
              <div className="mb-4 h-20 animate-pulse rounded-lg bg-zinc-800/50" />
              <div className="mb-2 h-3 w-16 animate-pulse rounded bg-zinc-800/50" />
              <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-zinc-800/50" />
              <div className="mb-1 h-3 w-full animate-pulse rounded bg-zinc-800/50" />
              <div className="mb-4 h-3 w-2/3 animate-pulse rounded bg-zinc-800/50" />
              <div className="border-t border-zinc-800/50 pt-4">
                <div className="h-3 w-20 animate-pulse rounded bg-zinc-800/50" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
