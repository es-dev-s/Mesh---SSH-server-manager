import { create } from "zustand";
import type { FileSystemNode, PathSegment } from "../pages/server/server-file-system";

interface ExplorerState {
  pathStack: PathSegment[];
  selectedId: string | null;
  items: FileSystemNode[];
  loading: boolean;
  error: string | null;

  setPathStack: (stack: PathSegment[] | ((prev: PathSegment[]) => PathSegment[])) => void;
  setSelectedId: (id: string | null) => void;
  setItems: (items: FileSystemNode[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useExplorerStore = create<ExplorerState>((set) => ({
  pathStack: [],
  selectedId: null,
  items: [],
  loading: false,
  error: null,

  setPathStack: (stack) =>
    set((state) => ({
      pathStack: typeof stack === "function" ? stack(state.pathStack) : stack,
    })),
  setSelectedId: (id) => set({ selectedId: id }),
  setItems: (items) => set({ items }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
