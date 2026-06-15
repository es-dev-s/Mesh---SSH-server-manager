import { useNavigationStore } from "../stores/useNavigationStore";
import { HomePage } from "./dashboard/HomePage";
import { ProxyPage } from "./proxy/ProxyPage";
import { DeployPage } from "./deploy/DeployPage";
import { ServerPage } from "./server/ServerPage";

export function PageView() {
  const activePageId = useNavigationStore((state) => state.activePageId);

  if (activePageId === "server") {
    return <ServerPage />;
  }

  if (activePageId === "proxy") {
    return <ProxyPage />;
  }

  if (activePageId === "deploy") {
    return <DeployPage />;
  }

  return <HomePage />;
}
