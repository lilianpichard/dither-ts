import { toast } from "sonner";

/** How long a render may run before the user is told to expect a wait. */
export const SLOW_OPERATION_MS = 4000;

/**
 * Warn once if an operation is still running after `delayMs`, and return a
 * function to call when it finishes.
 *
 * A slow render at full quality is not a failure, so it must not be cut short by
 * a deadline. The old 30s cap threw away the work and reported a timeout
 * instead, which is the opposite of what a large photo or clip deserves. This
 * only tells the user that the wait is expected; a genuinely wedged worker is a
 * separate concern from a slow one.
 */
export function warnIfSlow(delayMs: number, message: string): () => void {
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    toast.info(message);
  }, delayMs);
  return () => {
    // Already fired: nothing to cancel, and the toast stays up.
    if (!fired) clearTimeout(timer);
  };
}
