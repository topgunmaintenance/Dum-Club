import { createClient } from "./supabase/client";

export async function linkWalletToProfile(
  walletAddress: string,
  provider: string = "phantom"
) {
  const supabase = createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  if (!user) {
    throw new Error("No authenticated user found.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      wallet_address: walletAddress,
      wallet_provider: provider,
      wallet_verified: true,
    })
    .eq("id", user.id);

  if (error) {
    throw error;
  }

  return true;
}
