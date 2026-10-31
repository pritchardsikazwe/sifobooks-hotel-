import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { GuestPortal } from "./GuestPortal";
import "./styles.css";

class StartupErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("SifoBooks Hotel render error:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return <main className="auth-wrap"><section className="auth-card" role="alert">
        <div className="brand"><span className="brand-mark">S</span><div><strong>SifoBooks Hotel</strong><small>Application startup problem</small></div></div>
        <h1>The page could not load</h1>
        <p>The app encountered an unexpected error. Refresh the page. If it happens again, send support the error below.</p>
        <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",padding:12,borderRadius:10,background:"#0b0e16",color:"#ffb7ad",fontSize:12}}>{this.state.error}</pre>
        <button className="primary wide" onClick={() => window.location.reload()}>Refresh application</button>
      </section></main>;
    }
    return this.props.children;
  }
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // Installed PWAs and browser tabs check for a new service worker immediately
  // and then periodically while open. The worker calls skipWaiting() on install.
  const hadControllerAtStartup = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Do not reload the very first time a PWA is installed; reload only when an
    // already-running app is taken over by a newly activated worker.
    if (!hadControllerAtStartup || reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then(registration => {
        // Force the browser to revalidate sw.js instead of trusting its HTTP cache.
        void registration.update().catch(error => console.warn("Initial PWA update check failed:", error));
        window.setInterval(() => {
          if (navigator.onLine) {
            void registration.update().catch(error => console.warn("PWA update check failed:", error));
          }
        }, 60 * 1000);
      })
      .catch(error => console.error("PWA service worker registration failed:", error));
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StartupErrorBoundary>
      {new URLSearchParams(window.location.search).has("guest") ? <GuestPortal /> : <App />}
    </StartupErrorBoundary>
  </React.StrictMode>,
);
