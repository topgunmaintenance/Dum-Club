"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WalletProviders } from "./WalletProviders";
import { AuthProvider } from "../lib/auth/AuthContext";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    return <WalletProviders>{children}</WalletProviders>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["google", "email", "wallet"],
        embeddedWallets: {
          solana: {
            createOnLogin: "users-without-wallets",
          },
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
