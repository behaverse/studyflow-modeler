import { expect, test } from '@playwright/test';
import {
  checklistItems,
  parseChecklistLines,
  serializeChecklistLines,
} from '@core/document';

/** The shared checklist grammar: the inspector edits lines, the Checklist dialog lists items built on them. */

test('line view (inspector editor): what each line parses as, and what it serializes back to', () => {
  const CASES: [label: string, text: string, kinds: string[], serialized: string][] = [
    ['dash tasks round-trip', '- [ ] consent\n- [x] debrief', ['task', 'task'], '- [ ] consent\n- [x] debrief'],
    ['star and plus bullets are tasks too, and keep their bullet', '* [x] consent signed\n+ [ ] data archived', ['task', 'task'], '* [x] consent signed\n+ [ ] data archived'],
    ['lenient spacing and a capital X parse; the indent stays, the spacing is normalized', '  -   [X]   done', ['task'], '  - [x] done'],
    ['notes and headings stay plain rows, verbatim', '# Protocol\n- [ ] item\nfree-floating note', ['plain', 'task', 'plain'], '# Protocol\n- [ ] item\nfree-floating note'],
  ];
  for (const [label, text, kinds, serialized] of CASES) {
    const lines = parseChecklistLines(text);
    expect(lines.map((line) => line.kind), label).toEqual(kinds);
    expect(serializeChecklistLines(lines), label).toBe(serialized);
  }
});

test('item view (Checklist dialog): tasks of any bullet, plain bullets, and bare lines become items; blanks drop', () => {
  const items = checklistItems('- [x] a\n* [ ] b\n\n* plain bullet\nbare note\n');
  expect(items).toEqual([
    { text: 'a', checked: true, isCheckbox: true },
    { text: 'b', checked: false, isCheckbox: true },
    { text: 'plain bullet', checked: false, isCheckbox: false },
    { text: 'bare note', checked: false, isCheckbox: false },
  ]);
});
