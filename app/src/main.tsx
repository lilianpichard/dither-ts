import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import App from "./App";
import Providers from "./providers";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { describeUncaught } from "./status";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

// The last line of defence. The boundary in the tree catches what React reaches
// it with; these catch a rejection or an error that never became a render.
window.addEventListener("unhandledrejection", (event) => {
  toast.error(describeUncaught(event.reason));
});
window.addEventListener("error", (event) => {
  toast.error(describeUncaught(event.error ?? event.message));
});

root.render(
  <StrictMode>
    <Providers>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </Providers>
  </StrictMode>,
);
