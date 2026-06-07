"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WalletProviders } from "./WalletProviders";
import { AuthProvider } from "../lib/auth/AuthContext";

// Privy's internal SDK emits a handful of warnings during init —
// "Wallet proxy not initialized", "Failed to add embedded wallet
// connector", "no Solana wallet connectors", "useWallets was called
// outside the PrivyProvider" (a known once-per-route race). They're
// harmless and unfixable from outside the SDK. Silence them on the
// production bundle so the merchant + buyer devtools console reads
// clean. Dev + preview keeps the full stream so we can still
// investigate genuine regressions.
const _NOISY_WALLET_FRAGMENTS = [
  "Wallet proxy not initialized",
  "Failed to add embedded wallet connector",
  "no Solana wallet connectors",
];
if (
  typeof window !== "undefined" &&
  process.env.NODE_ENV === "production"
) {
  const _origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : String(args[0] || "");
    if (_NOISY_WALLET_FRAGMENTS.some((f) => first.includes(f))) return;
    _origWarn.apply(console, args);
  };
  const _origError = console.error;
  console.error = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : String(args[0] || "");
    if (_NOISY_WALLET_FRAGMENTS.some((f) => first.includes(f))) return;
    _origError.apply(console, args);
  };
}

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
        // Email first, Google second. Email OTP is a single-tab,
        // first-party flow that survives the iframe-to-new-tab
        // redirect cleanly. Google OAuth roundtrips through
        // auth.privy.io and Google.com, which can be flaky in
        // incognito + iframe-launched contexts. Privy renders
        // them in the order listed here.
        loginMethods: ["email", "google"],
        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
        },
        // No externalWallets.solana.connectors here, deliberately.
        // Wiring toSolanaWalletConnectors() makes Privy's wallet-proxy
        // iframe pre-fetch the WalletConnect explorer registry
        // (https://explorer-api.walletconnect.com/v3/wallets) on every
        // page load — including the public buyer storefront. Doctrine
        // §8 / §12.3 forbid Solana/blockchain code on consumer-facing
        // pages, and the buyer's only path is Stripe Checkout (card),
        // so there is nothing to connect to. The "no Solana wallet
        // connectors" / "Wallet proxy not initialized" warnings Privy
        // emits as a result are silenced by the noise filter above.
        // If/when SOL_CHECKOUT_ENABLED ships to prod, wire connectors
        // only on routes that actually need them — never globally.
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
