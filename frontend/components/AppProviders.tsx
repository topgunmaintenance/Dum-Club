"use client";

import { useEffect, useState } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { WalletProviders } from "./WalletProviders";
import { AuthProvider } from "../lib/auth/AuthContext";

// Pre-built once at module scope so the array reference is stable across
// renders. Without this, Privy's "Solana wallet login enabled, but no
// Solana wallet connectors have been passed to Privy" warning fires on
// every page — even though we use Solana via the wallet-adapter
// elsewhere. Privy's docs for v2+ require explicit external connectors
// when embeddedWallets.solana is configured.
const solanaConnectors = toSolanaWalletConnectors();

export function AppProviders({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Defer the entire Privy + Solana adapter tree to post-mount. Privy's
  // SDK reads from cookies / localStorage on its very first render to
  // hydrate session state, and that read produces different output on
  // the server (no cookies, returns "logged out") vs. the client
  // (sometimes "logged in"), which is the origin of the React #418 /
  // #423 hydration errors firing on every route. Rendering only the
  // bare children pre-mount makes the SSR HTML and the first client
  // paint byte-identical; the providers mount on the second render
  // and downstream consumers fall back to the no-op auth context until
  // then. See lib/auth/AuthContext.tsx for the fallback shape.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return <>{children}</>;

  if (!appId) {
    return <WalletProviders>{children}</WalletProviders>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["google", "email"],
        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
        },
        // Pass real Solana connectors so Privy's wallet-proxy iframe
        // initialises with something to attach to. Missing this triggers
        // both the "Wallet proxy not initialized" and the "no Solana
        // wallet connectors" warnings on every page load.
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        appearance: {
          theme: "dark",
          accentColor: "#00FFB2",
        },
      }}
    >
      <AuthProvider>
        <WalletProviders>{children}</WalletProviders>
      </AuthProvider>
    </PrivyProvider>
  );
}
