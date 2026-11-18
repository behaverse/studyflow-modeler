/** How a menu's search finds its rows: each word typed starts one of the row's words. */

/** Lower-cased runs of letters and digits: a query's terms, or a row's words. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Whether every term starts one of the words of `text`: "task" finds Task and Cognitive Task, not "servicetask". */
export function matchesTerms(text: string, terms: readonly string[]): boolean {
  const words = wordsOf(text);
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}
