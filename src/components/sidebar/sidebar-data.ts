import type { LucideIcon } from "lucide-react";
import { Home, Rocket, Server, Globe } from "lucide-react";
import type { PageId } from "../../pages/page-config";

export type SidebarItem = {
  id: PageId;
  label: string;
  icon: LucideIcon;
};

export const sidebarNavItems: SidebarItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "server", label: "Server", icon: Server },
  { id: "deploy", label: "Deploy", icon: Rocket },
  { id: "proxy", label: "Proxy", icon: Globe },
];
