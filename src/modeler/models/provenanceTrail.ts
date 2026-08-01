/**
 * The provenance trail — who acted on this studyflow, with what tool, when.
 *
 * A minimal, hand-editable form of W3C PROV (the mapping is written in
 * `assets/schemas/prov.moddle.yaml`): one `<prov:activity>` per event, appended
 * to the primary root element's `extensionElements`. Living *inside* the
 * document, the trail travels exactly as far as the diagram does — the
 * `.studyflow.yaml` source, the `.bpmn` XML, the payload embedded in
 * `.studyflow.svg` and `.studyflow.png` figures, git history, and the copy a
 * run archives — with no second embedding mechanism to keep in sync.
 *
 * Stamping is once-per-fact, not once-per-download: an export stamps only when
 * the trail is empty (`created`) or when edits happened since the last stamp
 * (`modified`). Re-exporting an untouched diagram — the example render
 * script's whole job — leaves the trail unchanged.
 */

export type TrailStamp = {
  action: string;
  when: string;
  who?: string;
  with?: string;
  what?: string;
  run?: string;
  seed?: string;
  note?: string;
};

/** The root the canvas shows — the diagram's own first (the element the DI
 *  plane names), then the usual type order for files that ship no DI. */
export function primaryRoot(definitions: any): any | undefined {
  const drawn = definitions?.diagrams?.[0]?.plane?.bpmnElement;
  if (drawn) return drawn;
  const roots: any[] = definitions?.rootElements ?? [];
  for (const type of ['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Choreography']) {
    const match = roots.find((root) => root.$type === type);
    if (match) return match;
  }
  return roots[0];
}

/** The trail's entries, oldest first; `[]` when the document has none. */
export function readTrail(definitions: any): any[] {
  const root = primaryRoot(definitions);
  const values: any[] = root?.extensionElements?.values ?? [];
  return values.filter((value) => value?.$type === 'prov:Activity');
}

/** ISO 8601 at second precision, in this machine's timezone. The numeric
 *  offset (`2026-08-01T09:12:04+02:00`) keeps the instant exact while
 *  preserving the writer's wall clock; older files carry `Z` stamps, and both
 *  forms are valid ISO 8601 instants. */
export function trailTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Append one `<prov:activity>` to the primary root, creating the
 *  `extensionElements` wrapper when the element has none yet. */
export function appendTrailEntry(
  definitions: any,
  moddle: any,
  stamp: TrailStamp,
): any | undefined {
  const root = primaryRoot(definitions);
  if (!root) return undefined;

  const entry = moddle.create('prov:Activity', pruneEmpty(stamp));
  if (!root.extensionElements) {
    root.extensionElements = moddle.create('bpmn:ExtensionElements', { values: [] });
    root.extensionElements.$parent = root;
  }
  root.extensionElements.values.push(entry);
  entry.$parent = root.extensionElements;
  return entry;
}

function pruneEmpty(stamp: TrailStamp): Record<string, string> {
  return Object.fromEntries(
    Object.entries(stamp).filter(([, value]) => typeof value === 'string' && value.length > 0),
  );
}

// ---------------------------------------------------------------------------
// Export stamping — when does an export owe the trail a line?
// ---------------------------------------------------------------------------

/** Command-stack position at the last stamp, per modeler. `-1` is the stack's
 *  own starting index, so a missing entry means "no edits recorded yet". */
const lastStampedAt = new WeakMap<object, number>();

const commandStackIndex = (modeler: any): number =>
  modeler.get('commandStack', false)?._stackIdx ?? -1;

/** Forget the stamp bookkeeping for `modeler` — called on import, where
 *  bpmn-js clears the command stack, so a fresh document starts unstamped. */
export function resetTrailStamping(modeler: any): void {
  lastStampedAt.delete(modeler);
}

/**
 * Stamp the open document for an export, if the export has anything new to
 * record: `created` when the trail is empty, `modified` when edits happened
 * since the last stamp. Returns the entry it appended, or `undefined` when the
 * trail already says everything this export could.
 */
export function stampTrailForExport(
  modeler: any,
  identity: { who?: string; tool: string },
): any | undefined {
  const definitions = modeler.getDefinitions?.();
  if (!definitions) return undefined;

  const stackIndex = commandStackIndex(modeler);
  const trail = readTrail(definitions);
  const edited = stackIndex !== (lastStampedAt.get(modeler) ?? -1);
  if (trail.length > 0 && !edited) return undefined;

  const entry = appendTrailEntry(definitions, modeler.get('moddle'), {
    action: trail.length === 0 ? 'created' : 'modified',
    when: trailTimestamp(),
    who: identity.who,
    with: identity.tool,
  });
  if (entry) lastStampedAt.set(modeler, stackIndex);
  return entry;
}
