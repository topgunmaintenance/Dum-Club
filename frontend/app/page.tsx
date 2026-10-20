/**
 * / (root) is the merchant-facing homepage: "go live on your own website"
 * (founder direction 2026-10-19). The buyer discovery feed (category
 * pills, Live now, the businesses grid) lives on /discover, which still
 * renders ClubHome. The interactive go-live demo (#demo) stays on the
 * homepage inside LiveOnYourSiteHome.
 */
import { LiveOnYourSiteHome } from "../components/homepage/LiveOnYourSiteHome";

export default function Home() {
  return <LiveOnYourSiteHome />;
}
