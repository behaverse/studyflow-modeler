/** What a message's content shows a person: its text, the fields of what it carries, and the options to answer by. */
export type MessageView = { texts: string[]; fields: [label: string, value: string][]; options: string[] };

const OPTIONS = ['ResponseOptions', 'options'];

/**
 * A message as the page shows it. The content is what the sending step sends: its data inputs by source id (the
 * trial, the instruction), or one value. Text is shown as text; a mapping shows its fields, and a list of strings
 * under `ResponseOptions` (or `options`) is what the person answers with; what holds nothing is left out.
 */
export function viewOf(content: unknown): MessageView {
  const view: MessageView = { texts: [], fields: [], options: [] };
  const show = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value !== 'object') {
      view.texts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(show);
      return;
    }
    for (const [key, held] of Object.entries(value)) {
      if (OPTIONS.includes(key) && Array.isArray(held) && held.every((option) => typeof option === 'string')) {
        view.options.push(...held.filter((option) => !view.options.includes(option)));
      } else if (held !== null && held !== undefined) {
        view.fields.push([key, typeof held === 'object' ? JSON.stringify(held) : String(held)]);
      }
    }
  };
  // The sending step's data inputs, by source id: each is shown as what it holds.
  const sources = content && typeof content === 'object' && !Array.isArray(content) && !OPTIONS.some((key) => key in content)
    ? Object.values(content)
    : [content];
  sources.forEach(show);
  return view;
}
