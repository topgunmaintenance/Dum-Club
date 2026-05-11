/**
 * LoomExplainer — responsive 16:9 Loom video embed used on the
 * homepage and the /investors page.
 *
 * Server-component-safe (no React state, no event handlers).
 * Uses the padding-bottom: 56.25% trick so the iframe stays
 * 16:9 across viewports without depending on `aspect-video`
 * being available in the consumer's Tailwind config.
 *
 * Iframe is lazy-loaded so the video only fetches when it
 * scrolls into the viewport, preserving Lighthouse / LCP.
 */

const LOOM_EMBED_URL = "https://www.loom.com/embed/27dd1fdf2fbf481b93b9ec9a1eec32cd";
const LOOM_SHARE_URL = "https://www.loom.com/share/27dd1fdf2fbf481b93b9ec9a1eec32cd";

type Props = {
  /** Optional className applied to the outer container so callers
   *  can control width / margin without forking the component. */
  className?: string;
};

export function LoomExplainer({ className }: Props) {
  return (
    <div className={className}>
      <div
        className="relative h-0 overflow-hidden rounded-2xl border border-default bg-surface-card shadow-sm"
        style={{ paddingBottom: "56.25%" }}
      >
        <iframe
          src={LOOM_EMBED_URL}
          title="DUM Club explainer video"
          loading="lazy"
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: 0,
          }}
        />
      </div>
      <p className="mt-3 text-center text-[12px] text-muted">
        Trouble with the embed?{" "}
        <a
          href={LOOM_SHARE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-brand-teal underline-offset-4 hover:underline"
        >
          Watch on Loom
        </a>
        .
      </p>
    </div>
  );
}
