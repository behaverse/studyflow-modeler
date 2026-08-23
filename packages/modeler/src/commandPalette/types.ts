export type PaletteCommand = {
  id: string;
  group: string;
  label: string;
  icon: string;
  hint?: string;
  /** Fires only while the search box is empty; see `CommandPalette`'s key handler. */
  shortcut?: string;
  action?: () => void | Promise<unknown>;
  children?: PaletteCommand[];
};

export type PaletteDialogId =
  | 'examples'
  | 'templates'
  | 'export'
  | 'publish'
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
    (c) => !c.children && (c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)),
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
