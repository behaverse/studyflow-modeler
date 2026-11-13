import type { EnumLiteral } from '@core/notation';

/** An enum's literal as a picker offers it: the label it shows, the value the file keeps, what it means. */
export type Option = { name: string; value: string; description?: string };

export function toOptions(literals: EnumLiteral[] | undefined): Option[] {
  return (literals ?? []).map((literal) => ({
    name: literal.name,
    value: String(literal.value),
    description: literal.description,
  }));
}

/** The options that match typed text: those whose label, value or description contains it, ignoring case. Empty text matches all. */
export function filterOptions(options: Option[], query: string): Option[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((option) =>
    option.name.toLowerCase().includes(q)
    || option.value.toLowerCase().includes(q)
    || option.description?.toLowerCase().includes(q));
}

/** A many-valued enum's values with `literal` ticked or unticked: the literals ticked, in the schema's order, then the
 * values the schema does not name, kept as they were. */
export function toggleLiteral(options: Option[], values: string[], literal: string): string[] {
  const named = options.map((option) => option.value);
  const selected = new Set(values);
  if (!selected.delete(literal)) selected.add(literal);
  return [...named.filter((value) => selected.has(value)), ...values.filter((value) => !named.includes(value))];
}

/** The value stored for typed text. The field shows a literal's label, so text equal to a label or a value, ignoring
 * case, stores that literal's value ("N-Back (NB)" -> "NB"); other text is kept as typed. */
export function resolveTyped(options: Option[], text: string): string {
  const typed = text.trim().toLowerCase();
  if (!typed) return '';
  const match = options.find((option) => option.name.toLowerCase() === typed || option.value.toLowerCase() === typed);
  return match ? match.value : text.trim();
}
