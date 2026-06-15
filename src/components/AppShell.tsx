import { MainContent } from "./MainContent";
import { Sidebar } from "./sidebar/Sidebar";
import { TitleBar } from "./TitleBar";
import { useSidebarStore } from "../stores/useSidebarStore";
import { useSshMonitor } from "../hooks/useSshMonitor";

export function AppShell() {
  useSshMonitor(); // Globally run connection monitoring at root
  const isExpanded = useSidebarStore((state) => state.isExpanded);
  const collapse = useSidebarStore((state) => state.collapse);

  function handleDismissSidebar() {
    if (isExpanded) {
      collapse();
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden flex-col bg-[#111111] text-[#f8f9fa]">
      <TitleBar />

      <div
        className="flex min-h-0 flex-1 overflow-hidden"
        onClick={handleDismissSidebar}
      >
        <Sidebar />
        <MainContent />
      </div>
    </div>
  );
}
