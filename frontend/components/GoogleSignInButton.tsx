"use client";

import { createClient } from "../lib/supabase/client";
import { useState } from "react";

export default function GoogleSignInButton() {
  const [hover, setHover] = useState(false);

  const handleGoogleSignIn = async () => {
    const supabase = createClient();

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <button
      type="button"
      onClick={handleGoogleSignIn}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? "rgba(0,255,178,0.08)" : "none",
        border: hover
          ? "1px solid rgba(0,255,178,0.35)"
          : "1px solid #2a2a2a",
        color: hover ? "#00FFB2" : "#e8e8e8",
        padding: "13px 18px",
        fontSize: "12px",
        letterSpacing: "0.13em",
        cursor: "pointer",
        fontFamily: "'Space Mono', monospace",
        textTransform: "uppercase",
        borderRadius: "14px",
        boxShadow: hover ? "0 0 10px rgba(0,255,178,0.25)" : "none",
        height: "52px",
        minWidth: "220px",
        transition: "all 0.15s ease",
      }}
    >
      Continue with Google
    </button>
  );
}
