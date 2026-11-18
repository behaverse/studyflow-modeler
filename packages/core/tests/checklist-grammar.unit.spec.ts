import { expect, test } from '@playwright/test';
import {
  checklistItems,
  parseChecklistLines,
  serializeChecklistLines,
  withTask,
  withTaskChecked,
} from '@core/document';

/** The shared checklist grammar: the inspector edits lines, the Checklist view lists items built on them and ticks them. */

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

test('item view (Checklist view): tasks of any bullet, plain bullets, and bare lines become items; blanks drop', () => {
  const items = checklistItems('- [x] a\n* [ ] b\n\n* plain bullet\nbare note\n');
  expect(items).toEqual([
    { text: 'a', checked: true, isCheckbox: true },
    { text: 'b', checked: false, isCheckbox: true },
    { text: 'plain bullet', checked: false, isCheckbox: false },
    { text: 'bare note', checked: false, isCheckbox: false },
  ]);
});

test('the Checklist view\'s edits: a tick lands on the task it shows, a new item goes last, the rest is kept', () => {
  const text = 'Before the visit:\n- [ ] consent\n* [x] debrief';
  expect(withTaskChecked(text, 1, false)).toBe('Before the visit:\n- [ ] consent\n* [ ] debrief');
  expect(withTaskChecked(text, 0, true)).toBe('Before the visit:\n- [x] consent\n* [x] debrief');
  expect(withTask(`${text}\n`, ' pay ')).toBe(`${text}\n- [ ] pay`);
  expect(withTask('', 'pay')).toBe('- [ ] pay');
});
