import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

/**
 * renderToStaticMarkup rethrows rather than running a boundary, so the state
 * machine is driven directly: getDerivedStateFromError is what react calls, and
 * render is then asked for the fallback exactly as react would ask.
 */
function caught(error: unknown, props: Record<string, unknown> = {}) {
  const boundary = mounted(new ErrorBoundary(props as never));
  boundary.state = { ...boundary.state, ...ErrorBoundary.getDerivedStateFromError(error) };
  // react renders what render() returns, so that is what the markup comes from.
  return () => boundary.render();
}

/**
 * An instance react has not mounted: setState is a no-op on one, so the updater
 * is applied by hand. That is exactly the transition retry performs.
 */
function mounted<T extends { state: unknown; setState: unknown }>(boundary: T): T {
  (boundary as { setState: (next: unknown) => void }).setState = (next) => {
    const patch = typeof next === "function" ? next(boundary.state) : next;
    Object.assign(boundary, { state: { ...(boundary.state as object), ...(patch as object) } });
  };
  return boundary;
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    const markup = renderToStaticMarkup(
      <ErrorBoundary>
        <p>body</p>
      </ErrorBoundary>,
    );
    expect(markup).toContain("<p>body</p>");
  });

  it("adds no wrapper element around the children", () => {
    // A boundary that introduced a div would break every layout it is dropped into.
    expect(renderToStaticMarkup(<ErrorBoundary>text</ErrorBoundary>)).toBe("text");
  });

  it("shows the message when a child throws", () => {
    const markup = renderToStaticMarkup(<>{caught(new Error("canvas too large"))()}</>);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("canvas too large");
    expect(markup).toContain("Try again");
  });

  it("still says something when the thrown value has no message", () => {
    for (const error of [undefined, null, {}, 0, ""]) {
      expect(renderToStaticMarkup(<>{caught(error)()}</>)).toContain("an unknown error");
    }
  });

  it("hands the message and a retry to an injected fallback", () => {
    const seen: { message: string; retry: () => void }[] = [];
    const render = caught(new Error("nope"), {
      fallback: (message: string, retry: () => void) => {
        seen.push({ message, retry });
        return <p>custom</p>;
      },
    });
    expect(renderToStaticMarkup(<>{render()}</>)).toContain("<p>custom</p>");
    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe("nope");
    expect(typeof seen[0].retry).toBe("function");
  });

  it("clears the error and remounts the subtree on retry", () => {
    const boundary = mounted(new ErrorBoundary({ children: null }));
    boundary.state = {
      ...boundary.state,
      ...ErrorBoundary.getDerivedStateFromError(new Error("boom")),
    };
    boundary.retry();
    expect(boundary.state.error).toBeNull();
    // The attempt is the key: without it react would reuse the broken subtree.
    expect(boundary.state.attempt).toBe(1);
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe("");
  });

  it("tells the handler about the throw", () => {
    const onError = vi.fn();
    const boundary = new ErrorBoundary({ children: null, onError });
    const info = { componentStack: "\n    at App" } as never;
    boundary.componentDidCatch(new Error("boom"), info);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][1]).toBe(info);
  });

  it("works with no handler and no fallback", () => {
    const boundary = new ErrorBoundary({ children: null });
    expect(() => boundary.componentDidCatch(new Error("x"), {} as never)).not.toThrow();
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe("");
  });
});
