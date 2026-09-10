import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "./context/AuthContext";
import { initializeTheme } from "./store/themeStore";
import { Toaster } from "./components/ui/Toaster";
import { warmStartupCode } from "./lib/performance/startupCode";
import "./index.css";

// Initialize theme before first render (handles localStorage + system pref)
initializeTheme();
void warmStartupCode(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
