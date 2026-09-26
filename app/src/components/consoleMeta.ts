import { createContext, useContext, useEffect } from "react";

export const ConsoleMetaContext = createContext<{
  tool: string;
  publish: (owner: string, value: string) => void;
}>({ tool: "", publish: () => {} });

/** Call from a panel with its own tool id and the header's right-slot text. */
export function useConsoleMeta(owner: string, value: string): void {
  const { tool, publish } = useContext(ConsoleMetaContext);
  useEffect(() => {
    if (tool === owner) publish(owner, value);
  }, [tool, owner, value, publish]);
}
