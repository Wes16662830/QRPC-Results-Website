import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { SeasonProvider } from "./season";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SeasonProvider>
        <App />
      </SeasonProvider>
    </BrowserRouter>
  </StrictMode>,
);
