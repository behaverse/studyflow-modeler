/**
 * Palette command model plus pure tree/search helpers.
 *
 * The palette content lives in `commands.ts` and the dialog UI in
 * `CommandPalette.tsx`; keeping the model free of React lets the registry
 * and the search logic evolve (and be tested) independently of the view.
 */

export type PaletteCommand = {
  id: string;
  /** Section header the command renders under; also matched by search. */
  group: string;
  label: string;
  icon: string;
  /** Right-aligned annotation, e.g. a file extension. Shortcuts win over hints. */
  hint?: string;
  /** Single-key shortcut, active only while the search box is empty. */
  shortcut?: string;
  /** Leaf action. Required unless `children` is set. */
  action?: () => void | Promise<void>;
  /** When present, the command opens a sub-palette instead of running. */
  children?: PaletteCommand[];
};

/** Modal dialogs the palette hands off to (one open at a time). */
export type PaletteDialogId = 'examples' | 'templates' | 'publish' | 'checklist' | 'gantt';

export function flattenCommands(commands: PaletteCommand[]): PaletteCommand[] {
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

/** Match every leaf across all submenus by label or group, case-insensitively. */
export function searchCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return flattenCommands(commands).filter(
    (c) => !c.children && (c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)),
  );
}

/** Bucket commands by group, preserving first-appearance order. */
export function groupCommands(commands: PaletteCommand[]): Array<[string, PaletteCommand[]]> {
  const map = new Map<string, PaletteCommand[]>();
  for (const c of commands) {
    if (!map.has(c.group)) map.set(c.group, []);
    map.get(c.group)!.push(c);
  }
  return Array.from(map);
}
