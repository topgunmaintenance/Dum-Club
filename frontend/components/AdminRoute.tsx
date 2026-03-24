"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/auth/AuthContext";

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      router.push("/");
    }
  }, [loading, user, isAdmin, router]);

  if (loading) return <div className="p-8 text-zinc-400">Loading admin...</div>;
  if (!user || !isAdmin) return null;
  return <>{children}</>;
}
