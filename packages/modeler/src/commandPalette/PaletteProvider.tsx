import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { CommandPalette, type CommandPaletteHandle } from '@modeler/commandPalette/CommandPalette';

const PaletteContext = createContext<{ openPalette: () => void }>({ openPalette: () => {} });

export const usePalette = () => useContext(PaletteContext);

/** The one command palette, which grows out of the composer: its prompt opens it, and ⌘K. */
export function PaletteProvider({ children }: { children: ReactNode }) {
  const ref = useRef<CommandPaletteHandle>(null);
  const value = useMemo(() => ({ openPalette: () => ref.current?.open() }), []);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette ref={ref} />
    </PaletteContext.Provider>
  );
}
