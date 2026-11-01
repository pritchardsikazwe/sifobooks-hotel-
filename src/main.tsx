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
      return (
        <main className="auth-wrap">
          <section className="auth-card" role="alert">
            <div className="brand">
              <span className="brand-mark">S</span>
              <div><strong>SifoBooks Hotel</strong><small>Application startup problem</small></div>
            </div>
            <h1>The page could not load</h1>
            <p>The app encountered an unexpected error. Your hotel records are not deleted. Try reloading the application. If the issue continues, use the recovery option on the startup screen.</p>
            <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",padding:12,borderRadius:10,background:"#eef3f8",color:"#8f2e35",fontSize:12}}>{this.state.error}</pre>
            <button className="primary wide" onClick={() => window.location.reload()}>Reload application</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  window.__sifohotelFail?.("The application root element is missing.");
} else {
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <StartupErrorBoundary>
        {new URLSearchParams(window.location.search).has("guest") ? <GuestPortal /> : <App />}
      </StartupErrorBoundary>
    </React.StrictMode>,
  );

  // Hide the static HTML safety screen only after React has had time to commit.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__sifohotelReady?.();
    document.documentElement.dataset.appReady = "true";
  }));

  // Register the PWA worker only after the application has mounted successfully.
  // This prevents a service-worker update from interrupting the first startup.
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    const hadControllerAtStartup = Boolean(navigator.serviceWorker.controller);
    let reloadingForUpdate = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadControllerAtStartup || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });

    window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then(registration => {
          void registration.update().catch(error => console.warn("Initial PWA update check failed:", error));
          window.setInterval(() => {
            if (navigator.onLine) {
              void registration.update().catch(error => console.warn("PWA update check failed:", error));
            }
          }, 60 * 60 * 1000);
        })
        .catch(error => console.error("PWA service worker registration failed:", error));
    }, 3000);
  }
}
