"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { WalletProviders } from "./WalletProviders";
import { AuthProvider } from "../lib/auth/AuthContext";

// Pre-built once at module scope so the array reference is stable across
// renders. Without this, Privy's "Solana wallet login enabled, but no
// Solana wallet connectors have been passed to Privy" warning fires on
// every page. Privy v2+ requires explicit external connectors when
// embeddedWallets.solana is configured.
const solanaConnectors = toSolanaWalletConnectors();

export function AppProviders({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // PrivyProvider must be mounted on the very first render. Page-level
  // components (app/page.tsx, app/embed/*, app/project/*, lib/auth/*)
  // call useSolanaWallets() / usePrivy() unconditionally at the top of
  // their tree, and any render where those hooks run without a
  // PrivyProvider ancestor throws "useWallets was called outside the
  // PrivyProvider component". An earlier change here deferred the
  // provider tree behind a useState/useEffect mount gate to chase a
  // hydration mismatch, which fixed that symptom but broke every
  // wallet hook on first paint. The legitimate hydration sources have
  // been addressed elsewhere (the deploy badge env-var read, and the
  // homepage `new Date().getFullYear()`); Privy itself is SSR-safe
  // per its documented usage, so it stays mounted from render zero.
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
        // Real Solana connectors so Privy's wallet-proxy iframe has
        // something to attach to on init. Missing this triggers both
        // the "Wallet proxy not initialized" and "no Solana wallet
        // connectors" warnings on every page load.
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
