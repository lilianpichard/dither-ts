import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Providers from "./providers";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// The last line of defence is registered inside App, where the translation
// provider exists: a message the user never sees is no use to them.

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </Providers>
  </StrictMode>,
);
