import { STUDY_EXTENSION_TYPE } from '@core/document/format';
import { inlineYamlValue, isExpressionType, isYamlValueProperty } from '@core/model/spelling';
import { idOf, isElement, type Element, type StudyModel, type Value } from '@core/model/index';
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

/** Who answers an actor pool: its kind and the program, model, or device that plays it, left out of a digest for any actor. */
const ACTOR = 'studyflow:Actor';
const BINDING = new Set(['actorType', 'implementation']);

/** Where a run puts what it adds to a study that had neither: the Study extension for its `state`, and its holder. */
const HOLDERS = new Set([STUDY_EXTENSION_TYPE, 'bpmn:ExtensionElements']);

const sorted = (entries: [string, unknown][]): Record<string, unknown> =>
  Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * A checklist enters the digest in the form it had when it was a documentation entry rather than an attribute of its
 * element: a `bpmn:Documentation` marked `checklist: true`, after the element's other documentation, its ticks
 * cleared. Moving it to an attribute changed how BPMN holds it, not the protocol, so a run sealed before still matches.
 */
function addChecklistEntry(entries: [string, unknown][], checklist: string): void {
  const entry = sorted([['$type', 'bpmn:Documentation'], ['checklist', true], ['text', unticked(checklist)]]);
  const documentation = entries.find(([key]) => key === 'documentation');
  if (documentation) (documentation[1] as unknown[]).push(entry);
  else entries.push(['documentation', [entry]]);
}

/* --- the digest of a study model --- */

/**
 * An element of a study model as `canonical` reads the same element in moddle: its BPMN type, with a schema's typed
 * element's attributes in a wrapper entry under `extensionElements`, expressions and documentation as elements, a
 * YAML-typed value as its mapping. So a protocol hashes the same, whichever holds the study.
 */
function canonicalIn(model: StudyModel, value: Value | undefined, declared: string | undefined, anyActor: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalIn(model, item, declared, anyActor));
  if (typeof value === 'string' && declared && model.metamodel.has(declared)) {
    if (isExpressionType(declared)) return canonicalElementIn(model, { type: 'bpmn:FormalExpression', body: value }, false, anyActor);
    if (declared === 'bpmn:Documentation') return canonicalElementIn(model, { type: declared, text: value }, false, anyActor);
  }
  // Where BPMN expects an element, a schema's typed element is that BPMN element; anywhere else (an extension entry) an
  // element is its own type.
  if (isElement(value)) return canonicalElementIn(model, value, !declared?.startsWith('bpmn:'), anyActor);
  if (!value || typeof value !== 'object') return value;
  return sorted(Object.entries(value).map(([key, item]) => [key, canonicalIn(model, item as Value, undefined, anyActor)]));
}

function canonicalElementIn(model: StudyModel, element: Element, entry: boolean, anyActor: boolean): unknown {
  const host = entry ? element.type : model.host(element);
  if (!model.metamodel.has(host)) return sorted([['$type', element.type]]);
  const unbound = anyActor && model.metamodel.isA(host, ACTOR);
  // What a kind of actor a skill declares adds to the actor (a simulated taker's planted accuracies) is who answers too.
  const actorOwn = unbound ? new Set(model.metamodel.descriptor(ACTOR).properties.map((p) => p.ns.localName)) : undefined;
  const typed = entry ? undefined : model.typedEntry(element);
  // For any actor, an actor is an actor, whatever kind a skill makes it.
  const entries: [string, unknown][] = [['$type', unbound ? ACTOR : host]];
  let checklist: string | undefined;
  for (const p of model.metamodel.descriptor(host).properties) {
    const key = p.ns.localName;
    if (p.isVirtual || DRAWING.has(key) || RECORDED.has(key) || (key === 'state' && host === STUDY_EXTENSION_TYPE)) continue;
    if (unbound && (BINDING.has(key) || !actorOwn!.has(key))) continue;
    let v: unknown = element[key];
    if (key === 'extensionElements') {
      const listed = [...(typed ? [typed] : []), ...(Array.isArray(v) ? v : isElement(v) && Array.isArray(v.values) ? v.values : [])];
      v = listed.length === 0 ? undefined : canonicalElementIn(model, { type: 'bpmn:ExtensionElements', values: listed }, false, anyActor);
      if (v !== undefined) entries.push([key, v]);
      continue;
    }
    // A node's flows in and out are what its container's sequence flows say, as the reader links them, after any it lists.
    if ((key === 'incoming' || key === 'outgoing') && p.isReference && !entry) v = flowsAt(model, element, key, v as Value[] | undefined);
    if (v === undefined || v === null || v === p.default) continue;
    if (key === 'checklist' && typeof v === 'string') {
      checklist = v;
      continue;
    }
    if (p.isReference) v = p.isMany ? (v as Value[]).map((ref) => idOf(ref) ?? ref) : idOf(v as Value) ?? v;
    else if (p.isMany) {
      v = (v as Value[]).filter((item) => !(isElement(item) && item.type === RUN_RECORD))
        .map((item) => canonicalIn(model, item, p.type, anyActor)).filter((item) => item !== undefined);
    } else if (isYamlValueProperty(p) && typeof v === 'string') {
      v = canonicalIn(model, (inlineYamlValue(v, p) ?? v) as Value, undefined, anyActor);
    } else v = canonicalIn(model, v as Value, p.type, anyActor);
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) entries.push([key, v]);
  }
  if (checklist !== undefined) addChecklistEntry(entries, checklist);
  return entries.length === 1 && HOLDERS.has(host) ? undefined : sorted(entries);
}

/** The sequence flows into or out of `element`, those it lists first, then the rest its container holds, in order. */
function flowsAt(model: StudyModel, element: Element, key: 'incoming' | 'outgoing', listed: Value[] | undefined): Value[] {
  const end = key === 'incoming' ? 'targetRef' : 'sourceRef';
  const siblings = model.parentOf(element)?.flowElements;
  const flows = (Array.isArray(siblings) ? siblings : []).filter((flow): flow is Element => isElement(flow)
    && model.isA(flow, 'bpmn:SequenceFlow') && flow[end] === element.id && typeof flow.id === 'string');
  const ids = (listed ?? []).map((ref) => idOf(ref)).filter((id): id is string => !!id);
  return [...ids, ...flows.map((flow) => flow.id!).filter((id) => !ids.includes(id))];
}

/**
 * The protocol a study describes, as `sha256:<hex>` over a canonical JSON of every root element and everything under
 * it, each element as BPMN holds it (a schema's typed element as its BPMN element and its schema's entry): not the
 * drawing, not the run `state`, not the per-element run records, not the drawing on semantic elements ({@link DRAWING}),
 * not what a run or an audit fills in ({@link RECORDED}, checklist ticks). `studyflow run` hands it to the run, which
 * records it as its `plan`, and `studyflow validate` recomputes it, so an executed copy whose protocol was edited after
 * the run no longer matches. With `anyActor`, it also leaves out who answers each actor pool ({@link BINDING}), so
 * copies of one study that differ only in the actor that takes it share that digest.
 */
export async function protocolDigest(model: StudyModel, options: { anyActor?: boolean } = {}): Promise<string> {
  const json = JSON.stringify(model.study.roots.map((root) => canonicalElementIn(model, root, false, options.anyActor ?? false)));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)));
  return `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
