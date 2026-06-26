/**
 * /discover — the Club home (buyer discovery + live). The page body lives in
 * the shared ClubHome component so the root (/) renders the exact same
 * experience.
 */
import { ClubHome } from "../../components/discover/ClubHome";

export default function DiscoverPage() {
  return <ClubHome />;
}
