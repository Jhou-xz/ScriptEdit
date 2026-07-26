import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import { Theme } from "@astryxdesign/core";
import { neutralTheme } from "@astryxdesign/theme-neutral";
import App from "./App";
import "./theme/tokens.css";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Theme theme={neutralTheme} mode="dark">
      <App />
    </Theme>
  </StrictMode>
);

