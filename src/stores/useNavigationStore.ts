import { create } from "zustand";
import type { PageId } from "../pages/page-config";

interface NavigationState {
  activePageId: PageId;
  setPage: (pageId: PageId) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activePageId: "home",
  setPage: (pageId) => set({ activePageId: pageId }),
}));
