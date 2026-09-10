import { create } from "zustand";

export type FilterChip = { type: "category" | "text"; value: string; label: string };
export type FilterAnimState = "idle" | "thinking" | "highlighting" | "filtered";

type Store = {
  chips: FilterChip[];
  animState: FilterAnimState;
  addChip: (chip: FilterChip, withThinking?: boolean) => void;
  removeChip: (value: string) => void;
  clearAll: () => void;
  setAnimState: (s: FilterAnimState) => void;
};

export const useTimelineFilterStore = create<Store>((set) => ({
  chips: [],
  animState: "idle",
  addChip: (chip, withThinking = false) =>
    set((state) => {
      if (state.chips.some((c) => c.value === chip.value)) return state;
      return {
        chips: [...state.chips, chip],
        animState: withThinking ? "thinking" : "highlighting",
      };
    }),
  removeChip: (value) =>
    set((state) => {
      const next = state.chips.filter((c) => c.value !== value);
      return { chips: next, animState: next.length === 0 ? "idle" : "filtered" };
    }),
  clearAll: () => set({ chips: [], animState: "idle" }),
  setAnimState: (animState) => set({ animState }),
}));
