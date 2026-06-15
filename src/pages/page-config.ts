export type PageId = "home" | "server";

export type PageMeta = {
  id: PageId;
  title: string;
  description: string;
};

export const pages: Record<PageId, PageMeta> = {
  home: {
    id: "home",
    title: "Home",
    description: "Your main workspace overview.",
  },
  server: {
    id: "server",
    title: "Server",
    description: "Manage connections, status, and server configuration.",
  },
};

export function getPageMeta(pageId: PageId): PageMeta {
  return pages[pageId];
}
