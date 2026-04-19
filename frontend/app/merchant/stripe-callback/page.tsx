"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { API_BASE } from "../../../lib/apiBase";
import { useAuth } from "../../../lib/auth/AuthContext";

function StripeCallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { getToken, loading: authLoading, user } = useAuth();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [error, setError] = useState("");

  useEffect(() => {
    // Wait for Privy to rehydrate the session after Stripe's browser
    // redirect. Without this, getToken() returns null and the backend
    // correctly rejects the request — producing a confusing "Connection
    // failed" even though the user is signed in.
    if (authLoading) return;

    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setStatus("error");
      setError("Missing authorization code");
      return;
    }

    if (!user) {
      setStatus("error");
      setError("You must be signed in to complete Stripe Connect. Sign in and try again.");
      return;
    }

    (async () => {
      // Backend requires a Privy bearer token: the callback is now an
      // authenticated endpoint so an attacker who only knows a victim's
      // Privy DID can't complete OAuth on their behalf.
      const token = await getToken();
      if (!token) {
        setStatus("error");
        setError("Could not get auth token. Sign in and retry.");
        return;
      }

      try {
        const res = await fetch(
          `${API_BASE}/api/merchant/stripe-connect/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          setStatus("success");
          setTimeout(() => router.push("/merchant"), 2000);
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus("error");
          setError(data.detail || "Connection failed");
        }
      } catch {
        setStatus("error");
        setError("Network error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="text-center">
        {status === "processing" && (
          <>
            <div className="mb-3 text-lg font-bold text-white">Connecting Stripe...</div>
            <p className="text-sm text-zinc-400">Please wait</p>
          </>
        )}
        {status === "success" && (
          <>
            <div className="mb-3 text-lg font-bold text-emerald-400">Stripe Connected!</div>
            <p className="text-sm text-zinc-400">Redirecting to merchant portal...</p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="mb-3 text-lg font-bold text-red-400">Connection Failed</div>
            <p className="text-sm text-zinc-400">{error}</p>
            <button onClick={() => router.push("/merchant")} className="mt-4 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-white hover:border-zinc-600">
              Back to Merchant Portal
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function StripeCallbackPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-zinc-950"><span className="text-sm text-zinc-500">Loading...</span></div>}>
      <StripeCallbackInner />
    </Suspense>
  );
}
