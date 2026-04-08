import { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({
  children,
  subtitle,
}: {
  children: ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="flex min-h-screen bg-gunmetal-950 text-ink-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar subtitle={subtitle} />
        <main className="flex-1 px-6 py-8 md:px-10 md:py-10">
          <div className="mx-auto max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
