import { create } from "zustand";

export type ServerTab =
  | { type: "explorer" }
  | { type: "terminal"; id: string; startupCommand?: string; title?: string }
  | { type: "editor"; path: string; name: string; isDirty?: boolean };

interface ServerTabsState {
  tabs: ServerTab[];
  activeTabIndex: number;

  addTab: (tab: ServerTab) => void;
  closeTab: (index: number) => void;
  setActiveTabIndex: (index: number) => void;
  setTabDirty: (path: string, isDirty: boolean) => void;
  resetTabs: () => void;
}

const DEFAULT_TABS: ServerTab[] = [{ type: "explorer" }];

export const useServerTabsStore = create<ServerTabsState>((set) => ({
  tabs: DEFAULT_TABS,
  activeTabIndex: 0,

  addTab: (tab) =>
    set((state) => {
      // Find if tab already exists
      const existingIndex = state.tabs.findIndex((t) => {
        if (t.type === "explorer" && tab.type === "explorer") return true;
        if (t.type === "terminal" && tab.type === "terminal" && t.id === tab.id) return true;
        if (t.type === "editor" && tab.type === "editor" && t.path === tab.path) return true;
        return false;
      });

      if (existingIndex >= 0) {
        return { activeTabIndex: existingIndex };
      }

      // Add new tab and focus it
      const newTabs = [...state.tabs, tab];
      return {
        tabs: newTabs,
        activeTabIndex: newTabs.length - 1,
      };
    }),

  closeTab: (index) =>
    set((state) => {
      // Don't close the file explorer tab (always at index 0)
      if (index === 0) return {};

      const newTabs = state.tabs.filter((_, i) => i !== index);
      let newActiveIndex = state.activeTabIndex;

      if (state.activeTabIndex >= index) {
        newActiveIndex = Math.max(0, state.activeTabIndex - 1);
      }

      return {
        tabs: newTabs,
        activeTabIndex: newActiveIndex,
      };
    }),

  setActiveTabIndex: (index) =>
    set((state) => ({
      activeTabIndex: Math.min(Math.max(0, index), state.tabs.length - 1),
    })),

  setTabDirty: (path, isDirty) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.type === "editor" && tab.path === path ? { ...tab, isDirty } : tab
      ),
    })),

  resetTabs: () =>
    set({
      tabs: DEFAULT_TABS,
      activeTabIndex: 0,
    }),
}));
