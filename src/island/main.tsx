import ReactDOM from "react-dom/client";
import { IslandApp } from "./IslandApp";
import "../index.css";

document.body.classList.add("island-root");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <IslandApp />,
);
