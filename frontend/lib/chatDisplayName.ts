/**
 * chatDisplayName — what a person is called in the PUBLIC live chat.
 *
 * Rules (host feedback 2026-07-02: "just says Viewer, who is this?"):
 * - Signed in with an email: the local part only ("jmero1", never the
 *   full "jmero1@gmail.com" — chat is broadcast to every viewer, and
 *   full addresses are a privacy leak + spam-harvest target).
 * - Signed in without an email (phone/social login variants): a stable
 *   short tag derived from the account id ("Viewer-8x7q"), so the host
 *   can at least tell people apart and recognize repeat chatters.
 * - Not signed in: the plain fallback.
 */
export function chatDisplayName(
  user: { email?: string | null; privyId?: string | null } | null | undefined,
  fallback: string = "Viewer",
): string {
  const email = user?.email?.trim();
  if (email && email.includes("@")) {
    const local = email.split("@")[0];
    return local.length > 24 ? local.slice(0, 24) : local;
  }
  const pid = user?.privyId?.trim();
  if (pid) {
    return `${fallback}-${pid.slice(-4)}`;
  }
  return fallback;
}
