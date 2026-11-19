import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

type ThemeStore = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
};

function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyTheme(mode: ThemeMode) {
  const resolved = resolveMode(mode);
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  mode: "dark",
  resolved: "dark",

  setMode: (mode) => {
    localStorage.setItem("orchestra-theme", mode);
    const resolved = applyTheme(mode);
    set({ mode, resolved });
  },

  cycleMode: () => {
    const next: ThemeMode =
      get().mode === "light" ? "dark" : get().mode === "dark" ? "auto" : "light";
    get().setMode(next);
  },
}));

/** Call once at app startup — reads localStorage, applies theme, wires system preference listener. */
export function initializeTheme() {
  const saved = localStorage.getItem("orchestra-theme");
  const stored: ThemeMode = saved === "light" || saved === "auto" ? saved : "dark";
  const resolved = applyTheme(stored);
  useThemeStore.setState({ mode: stored, resolved });

  // Re-resolve when system preference changes (only relevant in auto mode)
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const { mode, setMode } = useThemeStore.getState();
    if (mode === "auto") setMode("auto");
  });
}
