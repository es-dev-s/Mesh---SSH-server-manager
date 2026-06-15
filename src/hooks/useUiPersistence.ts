import { useEffect, useRef } from "react";
import { loadStoreValue, saveStoreValue, STORE_KEYS } from "../lib/persistence";
import { useExplorerStore } from "../stores/useExplorerStore";
import { useNavigationStore } from "../stores/useNavigationStore";
import { useServerTabsStore } from "../stores/useServerTabsStore";
import { useSidebarStore } from "../stores/useSidebarStore";

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer: number | undefined;
  return (...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

export function useUiPersistence() {
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const [navigation, sidebar, explorer, serverTabs] = await Promise.all([
        loadStoreValue<{ activePageId: string }>(STORE_KEYS.navigation),
        loadStoreValue<{ isExpanded: boolean }>(STORE_KEYS.sidebar),
        loadStoreValue<{ pathStack: unknown[]; selectedId: string | null }>(STORE_KEYS.explorer),
        loadStoreValue<{ tabs: unknown[]; activeTabIndex: number }>(STORE_KEYS.serverTabs),
      ]);

      if (cancelled) return;

      if (navigation?.activePageId) {
        useNavigationStore.setState({ activePageId: navigation.activePageId as never });
      }
      if (sidebar) {
        useSidebarStore.setState({ isExpanded: sidebar.isExpanded });
      }
      if (explorer) {
        useExplorerStore.setState({
          pathStack: explorer.pathStack as never,
          selectedId: explorer.selectedId,
        });
      }
      if (serverTabs?.tabs?.length) {
        useServerTabsStore.setState({
          tabs: serverTabs.tabs as never,
          activeTabIndex: serverTabs.activeTabIndex ?? 0,
        });
      }

      hydrated.current = true;
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const saveNavigation = debounce(() => {
      if (!hydrated.current) return;
      void saveStoreValue(STORE_KEYS.navigation, {
        activePageId: useNavigationStore.getState().activePageId,
      });
    }, 400);

    const saveSidebar = debounce(() => {
      if (!hydrated.current) return;
      void saveStoreValue(STORE_KEYS.sidebar, {
        isExpanded: useSidebarStore.getState().isExpanded,
      });
    }, 400);

    const saveExplorer = debounce(() => {
      if (!hydrated.current) return;
      const { pathStack, selectedId } = useExplorerStore.getState();
      void saveStoreValue(STORE_KEYS.explorer, { pathStack, selectedId });
    }, 400);

    const saveTabs = debounce(() => {
      if (!hydrated.current) return;
      const { tabs, activeTabIndex } = useServerTabsStore.getState();
      void saveStoreValue(STORE_KEYS.serverTabs, { tabs, activeTabIndex });
    }, 400);

    const unsubNavigation = useNavigationStore.subscribe(saveNavigation);
    const unsubSidebar = useSidebarStore.subscribe(saveSidebar);
    const unsubExplorer = useExplorerStore.subscribe(saveExplorer);
    const unsubTabs = useServerTabsStore.subscribe(saveTabs);

    return () => {
      unsubNavigation();
      unsubSidebar();
      unsubExplorer();
      unsubTabs();
    };
  }, []);
}
