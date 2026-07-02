/**
 * / (root) IS the Club home — the buyer discovery + live experience (the same
 * ClubHome rendered at /discover): category pills, Live now, Starting soon, the
 * businesses grid — followed by the merchant pitch + interactive go-live demo
 * (homeVariant). The old standalone marketing page at /welcome was removed
 * 2026-07-01; /welcome now 308-redirects here (see next.config.js).
 */
import { ClubHome } from "../components/discover/ClubHome";

export default function Home() {
  return <ClubHome homeVariant />;
}
