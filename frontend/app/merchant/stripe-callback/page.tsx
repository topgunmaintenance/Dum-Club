"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { API_BASE } from "../../../lib/apiBase";

export default function StripeCallbackPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [error, setError] = useState("");

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setStatus("error");
      setError("Missing authorization code");
      return;
    }

    fetch(`${API_BASE}/api/merchant/stripe-connect/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
      .then(async (res) => {
        if (res.ok) {
          setStatus("success");
          setTimeout(() => router.push("/merchant"), 2000);
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus("error");
          setError(data.detail || "Connection failed");
        }
      })
      .catch(() => {
        setStatus("error");
        setError("Network error");
      });
  }, []);

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
