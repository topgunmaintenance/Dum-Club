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
        // Caveat — handwriting font, loaded for the founder-note
        // signature line only. Wired through next/font/google in
        // app/layout.tsx; the Tailwind alias gives us
        // `font-caveat` for any element that wants the script
        // styling. Falls back to cursive system fonts during the
        // brief swap window.
        caveat: ["var(--font-caveat)", "Caveat", "cursive"],
      },
      colors: {
        base: "var(--color-bg-base)",
        card: "var(--color-bg-card)",
        panel: "var(--color-bg-panel)",
        dum: {
          green: "var(--color-green)",
          violet: "var(--color-violet)",
          // Handoff palette (June 2026) — emerald + dark/video surfaces.
          emerald: "var(--dum-emerald)",
          "emerald-700": "var(--dum-emerald-700)",
          "on-emerald": "var(--dum-on-emerald)",
          indigo: "var(--dum-indigo)",
          amber: "var(--dum-amber)",
          "amber-bg": "var(--dum-amber-bg)",
          "navy-card": "var(--dum-navy-card)",
          "navy-body": "var(--dum-navy-body)",
          "dark-panel": "var(--dum-dark-panel)",
          "live-accent": "var(--dum-live-accent)",
          "video-1": "var(--dum-video-1)",
          "video-2": "var(--dum-video-2)",
        },
        // Coral — Go Live + LIVE. coral = action/badge fill, coral-bg =
        // the pale "LIVE NOW" pill background. (Tailwind has no built-in
        // `coral`, so this is collision-free.)
        coral: {
          DEFAULT: "var(--dum-live)",
          bg: "var(--dum-live-bg)",
        },
        purple: {
          400: "#c084fc",
          500: "#a855f7",
          600: "#9333ea",
        },

        // ── Phase 0 light-theme tokens ─────────────────────────────
        // Added for the upcoming light-theme migration. NOT yet
        // referenced anywhere in the codebase — this PR is foundation
        // only. Existing dark-theme classes (bg-base, text-zinc-*,
        // text-white, etc.) stay unchanged. Values resolve through
        // CSS custom properties added under :root in globals.css so
        // both stay in sync for future runtime theme switching.
        brand: {
          teal: "var(--brand-teal)",
          "teal-hover": "var(--brand-teal-hover)",
          "teal-soft": "var(--brand-teal-soft)",
          navy: "var(--brand-navy)",
        },
        // Two-mint buyer-surface palette (legibility split — see
        // globals.css + CLAUDE.md §8). bg-mint-fill pairs with
        // text-mint-fill-ink on buttons; text-mint-text is mint used as
        // text/icons/prices on white.
        mint: {
          fill: "var(--mint-fill)",
          "fill-ink": "var(--mint-fill-ink)",
          text: "var(--mint-text)",
          // Mint card / status-bar surface (e.g. founding-merchant bar,
          // VERIFIED badge) — pale mint fill with its own hairline border.
          card: "var(--dum-mint)",
          "card-border": "var(--dum-mint-border)",
        },
        surface: {
          page: "var(--surface-page)",
          card: "var(--surface-card)",
          muted: "var(--surface-muted)",
          // bg-surface-inverse is the dark surface used for product-
          // preview / inverse-contrast sections per the master plan
          // (Phase 4). Pairs with text-white for readable inverted
          // typography.
          inverse: "var(--surface-inverse)",
        },
        state: {
          live: "var(--state-live)",
        },
      },
      // Split text + border tokens into their dedicated Tailwind
      // sections so semantic class names stay clean (`text-primary`,
      // `border-default`) instead of doubling the namespace
      // (`text-text-primary`, `border-border-default`). Each section
      // generates only the relevant utility for that concern.
      textColor: {
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        muted: "var(--text-muted)",
      },
      borderColor: {
        default: "var(--border-default)",
        strong: "var(--border-strong)",
      },
      borderRadius: {
        // Phone-screen inner radius for the mobile-first live screens.
        phone: "var(--dum-r-phone)",
      },
      boxShadow: {
        // Handoff shadow scale (design-tokens.css).
        "dum-card": "var(--dum-shadow-card)",
        "dum-elev": "var(--dum-shadow-elev)",
        "dum-dark": "var(--dum-shadow-dark)",
        "dum-coral": "var(--dum-shadow-coral)",
      },
      backgroundImage: {
        // Dark green-tinted gradient behind live camera previews / video.
        "dum-video":
          "radial-gradient(circle at 50% 35%, var(--dum-video-1), var(--dum-video-2))",
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
