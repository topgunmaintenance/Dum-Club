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

    // Open Graph enrichment for replay shares. When the storefront has
    // a replay_url (set externally by the IVS recording pipeline) we
    // surface it on the unfurl so a link pasted into Messages /
    // WhatsApp / IG DM previews as the actual recording rather than a
    // generic site card. og:video keeps the asset embedded inline;
    // og:image gives the static thumbnail when the consumer renders
    // a card instead of inline video. We do NOT auto-pick a poster
    // image from the recording (would require a frame-extract step);
    // upstream popin_config.poster_url is the merchant-controlled
    // hint for now.
    const replayUrl: string | null = project?.replay_url || null;
    const popinPoster: string | null =
      project?.popin_config?.poster_url ||
      project?.popin_config?.avatar_url ||
      null;
    const isLive = project?.is_live === true;
    const shareTitle = isLive
      ? `${name} is live now on DUM Club`
      : replayUrl
      ? `Watch ${name}'s last live show on DUM Club`
      : `${name} on DUM Club`;

    const openGraph: Metadata["openGraph"] = {
      title: shareTitle,
      description:
        desc ||
        `Shop ${name} on DUM Club. live offers, flash deals, and Stripe checkout.`,
      type: replayUrl && !isLive ? "video.other" : "website",
      ...(popinPoster ? { images: [{ url: popinPoster }] } : {}),
      ...(replayUrl && !isLive
        ? { videos: [{ url: replayUrl }] }
        : {}),
    };

    return {
      title: `${name} | DUM Club`,
      description:
        desc ||
        `Shop ${name} on DUM Club. live offers, flash deals, and Stripe checkout.`,
      openGraph,
      twitter: {
        card: popinPoster || (replayUrl && !isLive) ? "summary_large_image" : "summary",
        title: shareTitle,
        ...(popinPoster ? { images: [popinPoster] } : {}),
      },
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
