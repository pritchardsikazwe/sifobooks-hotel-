import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { GuestPortal } from "./GuestPortal";
import "./styles.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.error("PWA service worker registration failed:", error));
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("guest") ? <GuestPortal /> : <App />}
  </React.StrictMode>,
);