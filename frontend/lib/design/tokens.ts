/**
 * DUM Club design tokens — source of truth for the brand-teal +
 * light-theme system (Phase 9). Mirrors the CSS custom properties
 * defined in frontend/app/globals.css :root and the Tailwind
 * aliases registered in frontend/tailwind.config.js. Values here
 * resolve to `var(--*)` references so a future runtime theme
 * switch can flip the entire palette by overriding :root alone.
 *
 * Use these exports for inline styles, JS-driven animation values,
 * or anywhere a string token is needed in TypeScript. For JSX
 * className use the Tailwind aliases directly:
 *   bg-brand-teal · text-primary · border-default · text-secondary
 */

// ── Color ────────────────────────────────────────────────────────
export const color = {
  // Brand
  brandTeal: "var(--brand-teal)", //       #14B89A
  brandTealHover: "var(--brand-teal-hover)", // #0E9F84
  brandTealSoft: "var(--brand-teal-soft)", //   #E6F8F3
  brandNavy: "var(--brand-navy)", //       #0B2545

  // Surfaces
  surfacePage: "var(--surface-page)", //     #F7F8FA
  surfaceCard: "var(--surface-card)", //     #FFFFFF
  surfaceMuted: "var(--surface-muted)", //   #EEF1F5
  surfaceInverse: "var(--surface-inverse)", // #0B1220

  // Text
  textPrimary: "var(--text-primary)", //     #0B1220
  textSecondary: "var(--text-secondary)", // #475467
  textMuted: "var(--text-muted)", //         #6B7280

  // Border
  borderDefault: "var(--border-default)", // #E5E7EB
  borderStrong: "var(--border-strong)", //   #D1D5DB

  // State
  stateLive: "var(--state-live)", //         #E63946
} as const;

// ── Typography (Tailwind class strings) ─────────────────────────
// Pair with a text-* color class. Display through h3 are also the
// locked scale the <Heading> primitive renders against.
export const typography = {
  display:
    "text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]",
  h1: "text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.1]",
  h2: "text-2xl sm:text-3xl font-bold tracking-tight leading-tight",
  h3: "text-xl sm:text-2xl font-bold tracking-tight",
  bodyLg: "text-base sm:text-lg font-medium leading-relaxed",
  body: "text-sm sm:text-base leading-relaxed",
  caption: "text-xs sm:text-sm",
  eyebrow: "text-[11px] font-bold uppercase tracking-[0.2em]",
} as const;

// ── Spacing ─────────────────────────────────────────────────────
// Vertical rhythm comes through the <Section> primitive; the raw
// rem values here are for inline style cases where a class name
// won't work (canvas measurements, JS-driven animation, etc).
export const spacing = {
  xs: "0.5rem",
  sm: "1rem",
  md: "1.5rem",
  lg: "2.5rem",
  xl: "4rem",
  sectionY: {
    tight: "py-8 lg:py-12",
    default: "py-16 lg:py-24",
    loose: "py-24 lg:py-32",
  },
} as const;

// ── Border radius ───────────────────────────────────────────────
// Cards default to xl (rounded-2xl), buttons to lg (rounded-xl),
// pills to full. Locked to keep surfaces visually coherent.
export const radius = {
  none: "rounded-none",
  sm: "rounded-md", //  6px
  md: "rounded-lg", //  8px
  lg: "rounded-xl", // 12px
  xl: "rounded-2xl", // 16px
  full: "rounded-full",
} as const;

// ── Shadow ──────────────────────────────────────────────────────
// Neutral elevation for the light theme. Emerald-glow shadows from
// the dark era are deliberately absent — on a light page they read
// as smudges, not ambience.
export const shadow = {
  none: "shadow-none",
  sm: "shadow-sm",
  md: "shadow-md",
  lg: "shadow-lg",
  xl: "shadow-xl",
  // Standardised focus ring; matches Button's focus-visible state.
  focus:
    "focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]",
} as const;

// ── Motion ──────────────────────────────────────────────────────
// Components animating via class names should also use Tailwind's
// motion-reduce: variant; framer-motion consumers should pair with
// useReducedMotion(). Both honour the OS prefers-reduced-motion
// signal.
export const motion = {
  duration: {
    instant: "duration-100",
    fast: "duration-150",
    normal: "duration-200",
    slow: "duration-300",
    slower: "duration-500",
  },
  ease: {
    out: "ease-out",
    inOut: "ease-in-out",
    smooth: "[cubic-bezier(0.16,1,0.3,1)]",
  },
} as const;

// ── Z-index ─────────────────────────────────────────────────────
// Single source of truth for stacking. Anything above 50 should
// be a portal (modal, toast, command palette).
export const zIndex = {
  base: 0,
  raised: 10,
  sticky: 20,
  overlay: 30,
  drawer: 40,
  navbar: 50,
  modal: 100,
  toast: 200,
  popover: 300,
} as const;

export type ColorToken = keyof typeof color;
export type TypographyToken = keyof typeof typography;
export type RadiusToken = keyof typeof radius;
export type ShadowToken = keyof typeof shadow;
