/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Pull Geist via the CSS variables set by next/font on <html>.
        // Tailwind's font-sans / font-mono utilities now resolve to Geist
        // across the whole app; inline "Space Mono" styles still win
        // where they're hardcoded, and will be migrated in a follow-up.
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        base: "var(--color-bg-base)",
        card: "var(--color-bg-card)",
        panel: "var(--color-bg-panel)",
        dum: {
          green: "var(--color-green)",
          violet: "var(--color-violet)",
        },
        purple: {
          400: "#c084fc",
          500: "#a855f7",
          600: "#9333ea",
        },
      },
      keyframes: {
        fadeSlideDown: {
          "0%":   { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)"    },
        },
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "fade-slide-down": "fadeSlideDown 0.3s ease-out both",
        "fade-in":         "fadeIn 0.2s ease-out both",
      },
    },
  },
  plugins: [],
};
