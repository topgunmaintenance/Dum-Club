import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-gunmetal-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-14 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 text-gunmetal-950 shadow-glow">
              <span className="font-mono text-sm font-bold">T</span>
            </div>
            <div>
              <div className="text-[13px] font-semibold text-ink-100">
                Topgun AI
              </div>
              <div className="label-eyebrow">Maintenance Intelligence</div>
            </div>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-ink-400">
            AI maintenance intelligence for aviation teams. Source-cited
            answers from manuals, records, and parts data. Built for
            audit-grade decisions in a hangar, not a chat window.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-10 text-[12px] md:grid-cols-3">
          <FooterCol
            title="Product"
            links={[
              { href: "/dashboard", label: "Dashboard" },
              { href: "/query", label: "Query Workspace" },
              { href: "/library", label: "Document Library" },
              { href: "/insights", label: "Maintenance Insights" },
            ]}
          />
          <FooterCol
            title="System"
            links={[
              { href: "/admin", label: "System health" },
              { href: "/admin", label: "Processing logs" },
            ]}
          />
          <FooterCol
            title="Principles"
            links={[
              { href: "/", label: "Source-first" },
              { href: "/", label: "Audit-grade" },
              { href: "/", label: "Confidence explicit" },
            ]}
          />
        </div>
      </div>

      <div className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 text-[10.5px] uppercase tracking-[0.18em] text-ink-500">
          <span>© Topgun AI · All rights reserved</span>
          <span>Built for hangars · Source-first by design</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <div className="label-eyebrow mb-3">{title}</div>
      <ul className="space-y-2">
        {links.map((l, idx) => (
          <li key={`${title}-${idx}`}>
            <Link
              href={l.href}
              className="text-ink-300 transition hover:text-cyan-300"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
