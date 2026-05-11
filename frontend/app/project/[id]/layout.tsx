import type { Metadata } from "next";
import { API_BASE } from "../../../lib/apiBase";

type Params = { id: string };

// Dynamic metadata: pull the project name + description from the public
// API so the browser tab title shows the merchant's storefront instead
// of the global homepage title. If the fetch fails for any reason we
// fall back to a generic title rather than blowing up the request.
export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  try {
    const res = await fetch(`${API_BASE}/api/projects/${params.id}`, {
      // SSR fetch. cache briefly so a popular storefront doesn't pound
      // the API on every cold render but stays reasonably fresh.
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const body = await res.json();
    const project = body?.project ?? body ?? null;
    const name: string | null =
      project?.title || project?.name || null;
    const desc: string | null = project?.description || null;
    if (!name) throw new Error("no name");
    return {
      title: `${name} | DUM Club`,
      description:
        desc ||
        `Shop ${name} on DUM Club. live offers, flash deals, and Stripe checkout.`,
    };
  } catch {
    return {
      title: "Storefront | DUM Club",
      description:
        "A live DUM Club storefront with offers, flash deals, and Stripe checkout.",
    };
  }
}

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
