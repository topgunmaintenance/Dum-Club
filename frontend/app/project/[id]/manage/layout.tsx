/**
 * /project/[id]/manage layout — server-side owner gate.
 *
 * Per the storefront/dashboard split directive: "The owner check
 * must be server-side enforced on /b/[slug]/manage (redirect to
 * /b/[slug] if not owner). Do not rely on client-side hiding
 * alone."
 *
 * Implementation:
 *
 *   1. Read the Supabase session via the SSR cookies bridge
 *      (lib/supabase/server.ts — already used for the existing
 *      /admin/* routes' auth).
 *   2. If no authenticated user → redirect to the public
 *      storefront. We don't 401 because the customer view is
 *      a perfectly valid place to land for anyone.
 *   3. Fetch the project row (slug or UUID accepted via the
 *      url_or_slug match below) and compare the authenticated
 *      identity against owner_id, privy_id, and wallet_address —
 *      any match passes. Privy-authenticated users may have
 *      only privy_id set on the project until their wallet
 *      links, so we have to accept any of the three signals.
 *   4. Mismatch → redirect to /project/[id]. This keeps the
 *      manage URL inert for non-owners even if a curious
 *      visitor types it directly.
 *
 * The body of /manage continues to do its own client-side
 * checks via supabase.auth.getUser() in load(). That's fine —
 * the server gate is the load-bearing one; client checks are
 * defence-in-depth that also drive the UI before hydration.
 */

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "../../../../lib/supabase/server";

interface ManageLayoutProps {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ManageLayout({
  children,
  params,
}: ManageLayoutProps) {
  const { id } = await params;

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    // Misconfigured Supabase env on the deploy — fall through
    // to the public storefront rather than 5xx the manage URL.
    redirect(`/project/${id}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/project/${id}`);
  }

  // Resolve project owner identity. Accept slug or UUID for
  // the {id} param, mirroring the rest of /project/[id]'s
  // routing contract. PostgREST `or` filter lets us match
  // either column in one round trip.
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, owner_id, privy_id, wallet_address")
    .or(`id.eq.${id},slug.eq.${id}`)
    .limit(1);

  const project = projectRows?.[0];
  if (!project) {
    redirect(`/project/${id}`);
  }

  // Match any identity signal. Mirror the API's resolve_owner
  // chain (backend/api/routes/projects.py:318-324) so the
  // server gate matches the API's own "is this the owner?"
  // contract — no class of legitimate owner gets locked out.
  const userPrivyId =
    (user.user_metadata as Record<string, unknown> | null)?.privy_id ??
    (user.app_metadata as Record<string, unknown> | null)?.privy_id ??
    null;
  const userWallet =
    (user.user_metadata as Record<string, unknown> | null)?.wallet_address ??
    null;

  const ownerMatch =
    (project.owner_id && project.owner_id === user.id) ||
    (project.privy_id && userPrivyId && project.privy_id === userPrivyId) ||
    (project.wallet_address &&
      userWallet &&
      project.wallet_address === userWallet);

  if (!ownerMatch) {
    redirect(`/project/${id}`);
  }

  return <>{children}</>;
}
