import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider } from "./auth";
import { I18nProvider } from "./i18n";
import { Aurora } from "./components/Aurora";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <AuthProvider>
          <Aurora />
          <App />
        </AuthProvider>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
