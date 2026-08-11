export type RunSource =
  | { kind: 'url'; url: string }
  | { kind: 'handoff'; id: string };

const STUDYFLOW_FILE = /\.(studyflow|bpmn|xml|ya?ml)$/i;

/** A hand-off id is a bare uuid slice, so anything with a scheme, a slash, or a file extension is a URL. */
function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes('/') || STUDYFLOW_FILE.test(value);
}

/** One `diagram=` param, three kinds of value: a shipped demo's name, a URL to fetch, or a hand-off id. */
export function resolveRunSource(value: string, demos: Record<string, string> = {}): RunSource | undefined {
  const diagram = value.trim();
  if (!diagram) return undefined;
  if (demos[diagram]) return { kind: 'url', url: demos[diagram] };
  return looksLikeUrl(diagram) ? { kind: 'url', url: diagram } : { kind: 'handoff', id: diagram };
}

/** `diagram` names what to run, so it cannot be part of it; everything else parameterizes the studyflow. */
export function readParameters(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries([...params].filter(([name]) => name !== 'diagram'));
}
