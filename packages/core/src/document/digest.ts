import { isModdleElement, type ModdleElement } from '@core/element/moddle';
import { STUDY_EXTENSION_TYPE } from '@core/document/format';
import { inlineYamlValue } from '@core/document/shorthand';
import { parseChecklistLines, serializeChecklistLines } from '@core/document/checklist';

/** The per-element run records a run stamps on the elements it touched. */
const RUN_RECORD = 'prov:Activity';

/**
 * Drawing that sits on semantic elements rather than in the DI: the element's own `icon`, and its lanes, which
 * partition the drawing (the canvas files a shape into the lane it is dropped in).
 */
const DRAWING = new Set(['icon', 'laneSets']);

/** What a run or an audit fills in on a plan rather than plans: a Gantt `progress`; a checklist's ticks, below. */
const RECORDED = new Set(['progress']);

/** A checklist as planned: its items, every tick cleared, so ticking one off after the run is not a new protocol. */
const unticked = (markdown: string): string =>
  serializeChecklistLines(parseChecklistLines(markdown).map((line) => (line.kind === 'task' ? { ...line, checked: false } : line)));

/** Where a run puts what it adds to a study that had neither: the Study extension for its `state`, and its holder. */
const HOLDERS = new Set([STUDY_EXTENSION_TYPE, 'bpmn:ExtensionElements']);

const sorted = (entries: [string, unknown][]): Record<string, unknown> =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * A value as plain data: an element as its type and its properties by the moddle descriptors, references as ids, keys
 * sorted. A YAML value counts by the mapping it holds when the file may spell it as one, since a trip through the
 * file turns its text into that mapping and back into other text.
 */
function canonical(value: any): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  if (!isModdleElement(value)) return sorted(Object.entries(value).map(([key, item]) => [key, canonical(item)]));
  const entries: [string, unknown][] = [['$type', value.$type]];
  for (const p of value.$descriptor?.properties ?? []) {
    if (p.isVirtual || DRAWING.has(p.name) || RECORDED.has(p.name) || (p.name === 'state' && value.$type === STUDY_EXTENSION_TYPE)) continue;
    let v = value[p.name];
    if (v === undefined || v === null || v === p.default) continue;
    if (p.name === 'text' && value.checklist === true && typeof v === 'string') v = unticked(v);
    if (p.isReference) v = p.isMany ? v.map((ref: any) => ref?.id ?? ref) : v?.id ?? v;
    else if (p.isMany) v = v.filter((item: any) => item?.$type !== RUN_RECORD).map(canonical).filter((item: any) => item !== undefined);
    else v = canonical(inlineYamlValue(v, p) ?? v);
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) entries.push([p.name, v]);
  }
  return entries.length === 1 && HOLDERS.has(value.$type!) ? undefined : sorted(entries);
}

/**
 * The protocol a study describes, as `sha256:<hex>` over a canonical JSON of every root element and everything under
 * it: not the DI, not the run `state`, not the per-element run records, not the drawing on semantic elements
 * ({@link DRAWING}), not what a run or an audit fills in ({@link RECORDED}, checklist ticks). `studyflow run` hands it to the run, which records it as its `plan`, and `studyflow validate`
 * recomputes it, so an executed copy whose protocol was edited after the run no longer matches.
 */
export async function protocolDigest(definitions: ModdleElement): Promise<string> {
  const json = JSON.stringify((definitions.rootElements ?? []).map(canonical));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
