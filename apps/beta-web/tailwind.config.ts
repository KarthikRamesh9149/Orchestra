import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // v4 renames the smallest scales; keep existing component classes stable.
      borderRadius: { DEFAULT: "0.25rem", sm: "0.125rem", full: "9999px" },
      boxShadow: { sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)" },
      colors: {
        bg: "var(--bg)",
        bg1: "var(--bg-1)",
        bg2: "var(--bg-2)",
        border: "var(--border)",
        accent: "var(--rust)",
        accentDim: "var(--rust-tint)",
        teal: "var(--success-text)",
        tealDim: "var(--success-bg)",
        orange: "var(--rust)",
        purple: "var(--purple)",
        red: "var(--danger-text)",
        mint: "var(--success-bg)",
        lavender: "var(--purple-bg)",
        peach: "var(--warning-bg)",
        text1: "var(--text-1)",
        text2: "var(--text-2)",
        text3: "var(--text-3)",
        // New semantic aliases for merged/new components
        surface: "var(--surface)",
        "surface-alt": "var(--bg-inset)",
        ink: "var(--text-default)",
        muted: "var(--text-muted)",
        faint: "var(--text-faint)",
        brand: "var(--teal)",
        terracotta: "var(--terracotta)",
        danger: "var(--danger-text)"
      },
      fontFamily: {
        sans: ["Geist", "-apple-system", "system-ui", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", '"SF Mono"', "Menlo", "monospace"]
      }
    }
  },
  plugins: []
} satisfies Config;
