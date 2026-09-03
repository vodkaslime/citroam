import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createWorkspaceRepository } from "./data/workspaceRepository";
import "@fontsource-variable/outfit";
import "./styles.css";

const repository = createWorkspaceRepository();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App repository={repository} />
  </StrictMode>,
);
