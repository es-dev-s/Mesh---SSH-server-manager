import { MainContent } from "./MainContent";
import { Sidebar } from "./sidebar/Sidebar";
import { TitleBar } from "./TitleBar";
import { useSidebarStore } from "../stores/useSidebarStore";

export function AppShell() {
  const isExpanded = useSidebarStore((state) => state.isExpanded);
  const collapse = useSidebarStore((state) => state.collapse);

  function handleDismissSidebar() {
    if (isExpanded) {
      collapse();
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f5f5f7]">
      <Sidebar />

      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        onClick={handleDismissSidebar}
      >
        <TitleBar />
        <MainContent />
      </div>
    </div>
  );
}
