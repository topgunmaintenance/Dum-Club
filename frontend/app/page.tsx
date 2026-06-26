/**
 * / (root) IS the Club home — the buyer discovery + live experience (the same
 * ClubHome rendered at /discover): category pills, Live now, Starting soon, the
 * businesses grid, and the merchant CTA strip at the bottom.
 *
 * The previous merchant marketing homepage now lives at /welcome (reachable
 * via the For Business / Pricing nav links + the MerchantStrip CTA).
 */
import { ClubHome } from "../components/discover/ClubHome";

export default function Home() {
  return <ClubHome />;
}
