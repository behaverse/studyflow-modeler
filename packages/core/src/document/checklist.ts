export type ChecklistLine =
  | { kind: 'task'; indent: string; bullet: string; checked: boolean; text: string }
  | { kind: 'plain'; text: string };

export type ChecklistItem = {
  text: string;
  checked: boolean;
  isCheckbox: boolean;
};

const TASK_RE = /^(\s*)([-*+])\s+\[( |x|X)\]\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;

export function parseChecklistLines(markdown: string): ChecklistLine[] {
  if (!markdown.trim()) return [];
  return markdown.split(/\r?\n/).map((line): ChecklistLine => {
    const task = TASK_RE.exec(line);
    if (task) {
      return { kind: 'task', indent: task[1], bullet: task[2], checked: task[3].toLowerCase() === 'x', text: task[4] };
    }
    return { kind: 'plain', text: line };
  });
}

export function serializeChecklistLines(lines: ChecklistLine[]): string {
  return lines
    .map((line) => (line.kind === 'task'
      ? `${line.indent}${line.bullet} [${line.checked ? 'x' : ' '}] ${line.text}`
      : line.text))
    .join('\n');
}

export function checklistItems(markdown: string): ChecklistItem[] {
  return parseChecklistLines(markdown)
    .map((line): ChecklistItem | null => {
      if (line.kind === 'task') return { text: line.text.trim(), checked: line.checked, isCheckbox: true };
      const bullet = line.text.match(BULLET_RE);
      if (bullet) return { text: bullet[1].trim(), checked: false, isCheckbox: false };
      const trimmed = line.text.trim();
      return trimmed ? { text: trimmed, checked: false, isCheckbox: false } : null;
    })
    .filter((item): item is ChecklistItem => item !== null);
}
