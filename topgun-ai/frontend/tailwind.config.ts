import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        gunmetal: {
          950: "#07090d",
          900: "#0b0f16",
          800: "#0f141d",
          700: "#141a25",
          600: "#1a212e",
          500: "#222b3b",
          400: "#2c3648",
        },
        cyan: {
          400: "#22d3ee",
          500: "#06b6d4",
          600: "#0891b2",
        },
        amber: {
          400: "#fbbf24",
          500: "#f59e0b",
        },
        ink: {
          100: "#e6ecf5",
          200: "#c6cfdc",
          300: "#97a3b6",
          400: "#6b768a",
          500: "#4a5467",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,0.25), 0 10px 40px -10px rgba(34,211,238,0.35)",
        panel:
          "inset 0 1px 0 rgba(255,255,255,0.04), 0 12px 40px -20px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)",
        "radial-spotlight":
          "radial-gradient(80% 60% at 50% 0%, rgba(34,211,238,0.14) 0%, rgba(7,9,13,0) 60%)",
      },
      backgroundSize: {
        "grid-faint": "48px 48px",
      },
    },
  },
  plugins: [],
};

export default config;
