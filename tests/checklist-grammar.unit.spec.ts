import { expect, test } from '@playwright/test';
import {
  checklistItems,
  parseChecklistLines,
  serializeChecklistLines,
} from '@core/document';

/** The shared checklist grammar; pins that both surfaces agree on what a task line is. */

test.describe('line view (inspector editor)', () => {
  test('dash tasks parse and round-trip losslessly', () => {
    const text = '- [ ] consent\n- [x] debrief';
    expect(serializeChecklistLines(parseChecklistLines(text))).toBe(text);
  });

  test('star and plus bullets are tasks too, and keep their bullet character', () => {
    const text = '* [x] consent signed\n+ [ ] data archived';
    const lines = parseChecklistLines(text);
    expect(lines.every((line) => line.kind === 'task')).toBe(true);
    expect(serializeChecklistLines(lines)).toBe(text);
  });

  test('lenient spacing parses; indentation survives the round trip', () => {
    const text = '  -   [X]   done';
    const lines = parseChecklistLines(text);
    expect(lines[0]).toMatchObject({ kind: 'task', checked: true, text: 'done', indent: '  ' });
  });

  test('notes and headings stay as plain rows, verbatim', () => {
    const text = '# Protocol\n- [ ] item\nfree-floating note';
    const lines = parseChecklistLines(text);
    expect(lines.map((line) => line.kind)).toEqual(['plain', 'task', 'plain']);
    expect(serializeChecklistLines(lines)).toBe(text);
  });
});

test.describe('item view (Checklist dialog)', () => {
  test('tasks, plain bullets, and bare lines become items; blanks drop', () => {
    const items = checklistItems('- [x] a\n\n* plain bullet\nbare note\n');
    expect(items).toEqual([
      { text: 'a', checked: true, isCheckbox: true },
      { text: 'plain bullet', checked: false, isCheckbox: false },
      { text: 'bare note', checked: false, isCheckbox: false },
    ]);
  });

  test('both views agree on what counts as a checkbox (the old divergence)', () => {
    const text = '* [x] star-bulleted task';
    const [line] = parseChecklistLines(text);
    const [item] = checklistItems(text);
    expect(line.kind).toBe('task');
    expect(item.isCheckbox).toBe(true);
  });
});
