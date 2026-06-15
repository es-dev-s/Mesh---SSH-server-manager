import { useNavigationStore } from "../stores/useNavigationStore";
import { HomePage } from "./dashboard/HomePage";
import { ServerPage } from "./server/ServerPage";

export function PageView() {
  const activePageId = useNavigationStore((state) => state.activePageId);

  if (activePageId === "server") {
    return <ServerPage />;
  }

  return <HomePage />;
}
