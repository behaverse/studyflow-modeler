export type PaletteCommand = {
  id: string;
  group: string;
  label: string;
  icon: string;
  hint?: string;
  /** Extra search terms, for a command whose label no longer holds the word people look for. */
  keywords?: string;
  /** Fires only while the search box is empty; see `CommandPalette`'s key handler. */
  shortcut?: string;
  /** Drawn as a tile in a row above its group's list rows, which then carries no group label. */
  tile?: boolean;
  action?: () => void | Promise<unknown>;
  children?: PaletteCommand[];
};

export type PaletteDialogId =
  | 'gallery'
  | 'open'
  | 'save'
  | 'checklist'
  | 'gantt'
  | 'provenance';

function flattenCommands(commands: PaletteCommand[]): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  for (const c of commands) {
    out.push(c);
    if (c.children) out.push(...flattenCommands(c.children));
  }
  return out;
}

export function findCommand(commands: PaletteCommand[], id: string): PaletteCommand | null {
  for (const c of commands) {
    if (c.id === id) return c;
    if (c.children) {
      const hit = findCommand(c.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

export function searchCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return flattenCommands(commands).filter(
    (c) => !c.children
      && (c.label.toLowerCase().includes(q)
        || c.group.toLowerCase().includes(q)
        || !!c.keywords?.toLowerCase().includes(q)),
  );
}

export function groupCommands(commands: PaletteCommand[]): Array<[string, PaletteCommand[]]> {
  const map = new Map<string, PaletteCommand[]>();
  for (const c of commands) {
    if (!map.has(c.group)) map.set(c.group, []);
    map.get(c.group)!.push(c);
  }
  return Array.from(map);
}
