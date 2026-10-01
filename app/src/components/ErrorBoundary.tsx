import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

/** What the fallback needs to say, without knowing what threw. */
function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "an unknown error";
}

interface Props {
  children: ReactNode;
  /** Shown instead of the children. Kept injectable so tests need no DOM. */
  fallback?: (message: string, retry: () => void) => ReactNode;
  /** Told about the throw, so it can be logged or reported. */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface State {
  /** Whether a child threw. A separate flag, because `undefined` is thrown. */
  failed: boolean;
  error: unknown;
  /** Bumped on retry; as a key it makes React build a fresh subtree. */
  attempt: number;
}

/**
 * Catches a throw from render or from an effect below it. Without one, any
 * error anywhere unmounts the whole app and the user is left with a blank page
 * and their work gone, with nothing to report.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  retry = (): void => {
    this.setState((state) => ({ failed: false, error: null, attempt: state.attempt + 1 }));
  };

  render(): ReactNode {
    const { failed, attempt } = this.state;
    if (failed) {
      const message = describe(this.state.error);
      if (this.props.fallback) return this.props.fallback(message, this.retry);
      return (
        <div role="alert" className="p-4 text-label text-destructive">
          <p>{message}</p>
          <button type="button" onClick={this.retry} className="mt-2 underline">
            Try again
          </button>
        </div>
      );
    }
    return <Fragment key={attempt}>{this.props.children}</Fragment>;
  }
}
