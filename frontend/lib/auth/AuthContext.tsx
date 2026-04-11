"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

import { API_BASE } from "../apiBase";

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
  // Guard: track which (user.id + wallet) combination was last synced.
  // Using a composite key means we re-sync once when Privy lazily provisions
  // an embedded wallet for Google users after the initial login sync.
  const syncedForRef = useRef<string | null>(null);
  const syncInFlightRef = useRef(false);

  // Stable primitive: address of first available wallet, or "" if none yet.
  // Used as dep so the effect re-fires when a wallet is provisioned.
  const firstWalletAddress = wallets[0]?.address ?? "";

  // Refs always hold the latest Privy functions; updated every render before
  // any effect or memo runs. Refs themselves do not cause re-renders.
  const loginRef = useRef(login);
  const logoutRef = useRef(logout);
  const getAccessTokenRef = useRef(getAccessToken);
  loginRef.current = login;
  logoutRef.current = logout;
  getAccessTokenRef.current = getAccessToken;

  // Stable wrappers created once — reference never changes across renders.
  // Dispatch through refs so they always invoke the current Privy function.
  const stableLogin    = useRef(() => loginRef.current()).current;
  const stableLogout   = useRef(() => logoutRef.current()).current;
  const stableGetToken = useRef(async () => (await getAccessTokenRef.current()) || null).current;

  useEffect(() => {
    if (!ready) return;

    if (!authenticated || !user) {
      setDumUser(null);
      setLoading(false);
      syncedForRef.current = null;
      return;
    }

    // Already synced for this (user + wallet) combination, or a sync is running.
    const syncKey = `${user.id}:${firstWalletAddress}`;
    if (syncedForRef.current === syncKey || syncInFlightRef.current) return;
    syncedForRef.current = syncKey;
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

        // Referral conversion: if user signed up via a referral link
        if (accessToken) {
          try {
            const refCode = localStorage.getItem("dum_referral_code");
            if (refCode) {
              await fetch(`${API_BASE}/api/referrals/convert/${refCode}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              localStorage.removeItem("dum_referral_code");
            }
          } catch {}
        }
      } catch (err) {
        console.error("Auth sync failed", err);
        setDumUser(null);
      } finally {
        setLoading(false);
      }
    };

    syncUser().finally(() => { syncInFlightRef.current = false; });
  // user.id + firstWalletAddress form a composite key: re-syncs once when Privy
  // lazily provisions an embedded wallet for Google users after initial login.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, user?.id, firstWalletAddress]);

  const value = useMemo<AuthContextType>(
    () => ({
      user: dumUser,
      loading,
      isAdmin: Boolean(dumUser?.isAdmin),
      login: stableLogin,
      logout: stableLogout,
      getToken: stableGetToken,
    }),
    [dumUser, loading]
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
