export type PageId = "home" | "server" | "proxy" | "deploy";

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
  proxy: {
    id: "proxy",
    title: "Proxy",
    description: "Manage nginx reverse-proxy mappings and domain setup.",
  },
  deploy: {
    id: "deploy",
    title: "Deploy",
    description: "Deploy GitHub apps to the server with PM2 and go live.",
  },
};

export function getPageMeta(pageId: PageId): PageMeta {
  return pages[pageId];
}
