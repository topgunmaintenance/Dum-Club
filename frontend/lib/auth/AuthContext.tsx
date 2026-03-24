"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type LinkedWallet = { address: string; type: string };

type DumUser = {
  privyId: string;
  email: string | null;
  walletAddress: string | null;
  isAdmin: boolean;
  accessToken: string | null;
};

type AuthContextType = {
  user: DumUser | null;
  loading: boolean;
  isAdmin: boolean;
  login: () => void;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useSolanaWallets();
  const [dumUser, setDumUser] = useState<DumUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;

    if (!authenticated || !user) {
      setDumUser(null);
      setLoading(false);
      return;
    }

    const syncUser = async () => {
      try {
        setLoading(true);
        const accessToken = await getAccessToken();
        const linkedWallets: LinkedWallet[] = wallets.map((w) => ({
          address: w.address,
          type: String(w.walletClientType),
        }));
        const embeddedWallet = linkedWallets.find((w) => w.type === "privy") || null;
        const activeWallet = linkedWallets[0] || embeddedWallet;

        let isAdmin = false;
        if (accessToken) {
          try {
            const res = await fetch(`${API_BASE}/api/auth/sync`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                privy_id: user.id,
                email: user.email?.address || null,
                embedded_wallet: embeddedWallet?.address || null,
                linked_wallets: linkedWallets,
                google_linked: Boolean(user.google),
              }),
            });
            if (res.ok) {
              const synced = await res.json();
              isAdmin = Boolean(synced?.is_admin);
            } else {
              console.error("Auth sync HTTP error", res.status);
            }
          } catch (fetchErr) {
            console.error("Auth sync request failed", fetchErr);
          }
        }

        setDumUser({
          privyId: user.id,
          email: user.email?.address || null,
          walletAddress: activeWallet?.address || null,
          isAdmin,
          accessToken: accessToken || null,
        });
      } catch (err) {
        console.error("Auth sync failed", err);
        setDumUser(null);
      } finally {
        setLoading(false);
      }
    };

    syncUser();
  }, [ready, authenticated, user, wallets, getAccessToken]);

  const value = useMemo<AuthContextType>(
    () => ({
      user: dumUser,
      loading,
      isAdmin: Boolean(dumUser?.isAdmin),
      login,
      logout,
      getToken: async () => (await getAccessToken()) || null,
    }),
    [dumUser, loading, login, logout, getAccessToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
