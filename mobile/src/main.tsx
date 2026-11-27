// First: fills in what an old Android WebView lacks before any other module runs.
import "./polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./styles.css";

declare global {
  interface Window {
    /** Set once the app has started; index.html's too-old-WebView notice checks it. */
    __appBooted?: boolean;
  }
}

window.__appBooted = true;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
