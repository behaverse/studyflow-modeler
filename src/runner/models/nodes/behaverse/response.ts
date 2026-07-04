/** Normalize an LLM's raw reply for comparison: trim and strip surrounding
 *  backticks, quotes, punctuation, and whitespace. */
export function normalizeReply(raw: string): string {
  return raw.trim().replace(/^[`"'\s]+|[`"'.\s]+$/g, '');
}

/** Pick the response option which is contained in (or contains) the LLM's raw
 *  text. Falls back to a uniformly random choice when nothing matches. */
export function matchResponseOption(raw: string, options: string[]): string {
  const lower = normalizeReply(raw).toLowerCase();

  // exact match
  for (const c of options) {
    if (c.toLowerCase() === lower) return c;
  }

  // inclusion
  for (const c of options) {
    if (lower.includes(c.toLowerCase())) return c;
  }
  return options[Math.floor(Math.random() * options.length)];
}
