import { create } from "zustand";

interface SidebarState {
  isExpanded: boolean;
  toggle: () => void;
  expand: () => void;
  collapse: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isExpanded: false,
  toggle: () => set((state) => ({ isExpanded: !state.isExpanded })),
  expand: () => set({ isExpanded: true }),
  collapse: () => set({ isExpanded: false }),
}));
