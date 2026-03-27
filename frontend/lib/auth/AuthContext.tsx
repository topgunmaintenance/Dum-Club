"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  // Guard: track which user.id was last synced and whether a sync is in flight.
  // This prevents repeated calls when Privy re-renders with new object references.
  const syncedForRef = useRef<string | null>(null);
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    if (!ready) return;

    if (!authenticated || !user) {
      setDumUser(null);
      setLoading(false);
      syncedForRef.current = null;
      return;
    }

    // Already synced for this user this session, or a sync is already running.
    if (syncedForRef.current === user.id || syncInFlightRef.current) return;
    syncedForRef.current = user.id;
    syncInFlightRef.current = true;

    const syncUser = async () => {
      try {
        setLoading(true);
        const accessToken = await getAccessToken();
        // Read wallets at call time — not a dep to avoid unstable array refs.
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

    syncUser().finally(() => { syncInFlightRef.current = false; });
  // user.id is the stable identifier — avoids re-triggering on Privy object re-renders.
  // wallets is read inside syncUser at call time, not needed as dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, user?.id]);

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

const _AUTH_NOOP: AuthContextType = {
  user: null,
  loading: false,
  isAdmin: false,
  login: () => {},
  logout: async () => {},
  getToken: async () => null,
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  return ctx ?? _AUTH_NOOP;
}
