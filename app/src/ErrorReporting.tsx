// Failures that never became a render: a rejected promise, or an error event.
// Registered from inside the tree so the message can be translated.

import { useEffect } from "react";
import { toast } from "sonner";
import { describeUncaught } from "./status";
import { useTranslate } from "./i18n";

export function useGlobalErrors(): void {
  const t = useTranslate();
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      toast.error(describeUncaught(event.reason, t));
    };
    const onError = (event: ErrorEvent) => {
      toast.error(describeUncaught(event.error ?? event.message, t));
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, [t]);
}
