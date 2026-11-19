import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTheme, useThemeStore } from "./themeStore";

describe("appearance on first paint and subsequent launches", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(window, "matchMedia").mockImplementation(() => ({
      matches:false, media:"(prefers-color-scheme: dark)", onchange:null,
      addListener:vi.fn(), removeListener:vi.fn(), addEventListener:vi.fn(), removeEventListener:vi.fn(), dispatchEvent:vi.fn()
    }));
  });
  it("starts in dark mode even on a light system when there is no preference", () => {
    initializeTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(useThemeStore.getState().mode).toBe("dark");
  });
  it.each(["light", "auto"] as const)("honours an explicitly saved %s choice on a later launch", mode => {
    useThemeStore.getState().setMode(mode);
    initializeTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(useThemeStore.getState().mode).toBe(mode);
  });
});
