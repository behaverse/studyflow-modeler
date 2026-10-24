/**
 * The names a `.studyflow.yaml` file gives BPMN's keys, per element type, the kinds an event's definition is written
 * under, and how an activity's marker is (docs/reference.qmd, "Elements and their keys"). A file's key is the BPMN
 * property's name made shorter by three rules (a reference drops its `Ref`, a true-or-false its `is`, a key what the
 * element holding it already says), or a name of its own; a rule never gives a key a name its element already holds for
 * another property, so each key stands for one property of each type and reads back as it.
 */
import { BUILTIN_TYPES, type Metamodel, type PropertyDef } from '@core/model/metamodel';

/** Keys named for what they hold in a study. */
const OWN: Readonly<Record<string, string>> = {
  flowElements: 'elements',
  flowNodeRef: 'nodes',
  itemRef: 'item',
  itemSubjectRef: 'item',
  dataInputAssociations: 'inputs',
  dataOutputAssociations: 'outputs',
  extensionElements: 'extensions',
  conditionExpression: 'condition',
  participantMultiplicity: 'multiplicity',
};

/** An activity's marker, written under `loopCharacteristics` holding its settings: a standard loop names no type
 * (`true` when it holds nothing), a multi-instance marker names its own. */
export const STANDARD_LOOP = 'bpmn:StandardLoopCharacteristics';
export const MULTI_INSTANCE_LOOP = 'bpmn:MultiInstanceLoopCharacteristics';
/** The loop markers, whose keys drop the `loop` their holder already says; a standard loop's condition reads `while`. */
export const LOOP_MARKERS: ReadonlySet<string> = new Set([STANDARD_LOOP, MULTI_INSTANCE_LOOP]);

/** An event's one definition, written under the key of its kind, holding its main attribute. */
export const EVENT_KINDS: Readonly<Record<string, { key: string; main?: string }>> = {
  'bpmn:TimerEventDefinition': { key: 'timer', main: 'timeDuration' },
  'bpmn:MessageEventDefinition': { key: 'message', main: 'messageRef' },
  'bpmn:ConditionalEventDefinition': { key: 'condition', main: 'condition' },
  'bpmn:ErrorEventDefinition': { key: 'error', main: 'errorRef' },
  'bpmn:SignalEventDefinition': { key: 'signal', main: 'signalRef' },
  'bpmn:EscalationEventDefinition': { key: 'escalation', main: 'escalationRef' },
  'bpmn:LinkEventDefinition': { key: 'link', main: 'name' },
  'bpmn:CompensateEventDefinition': { key: 'compensation', main: 'activityRef' },
  'bpmn:CancelEventDefinition': { key: 'cancel' },
  'bpmn:TerminateEventDefinition': { key: 'terminate' },
};

/** The id an event's one definition takes when the file leaves it out. */
export const definitionId = (eventId: string): string => `${eventId}_Def`;

const lower = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

function shortened(type: string, p: PropertyDef): string {
  const name = p.ns.localName;
  if (name in OWN) return OWN[name];
  if (type === STANDARD_LOOP && name === 'loopCondition') return 'while';
  let key = name;
  if (LOOP_MARKERS.has(type) && /^loop[A-Z]/.test(key)) key = lower(key.slice(4));
  if (/.Ref$/.test(key)) key = key.slice(0, -3);
  if (p.type === 'Boolean' && /^is[A-Z]/.test(key)) key = lower(key.slice(2));
  return key;
}

type Names = { file: Map<string, string>; model: Map<string, string> };
const cache = new WeakMap<Metamodel, Map<string, Names>>();

/** A type's keys both ways: each property's name to its file key, and back. */
function namesOf(metamodel: Metamodel, type: string): Names {
  let byType = cache.get(metamodel);
  if (!byType) cache.set(metamodel, (byType = new Map()));
  const known = byType.get(type);
  if (known) return known;
  const names: Names = { file: new Map(), model: new Map() };
  if (metamodel.has(type)) {
    const { properties, propertiesByName } = metamodel.descriptor(type);
    const keys = new Map(properties.map((p) => [p, shortened(type, p)]));
    const taken = new Map<string, number>();
    for (const key of keys.values()) taken.set(key, (taken.get(key) ?? 0) + 1);
    for (const [p, key] of keys) {
      const name = p.ns.localName;
      const clash = key !== name && ((taken.get(key) ?? 0) > 1 || (propertiesByName[key] !== undefined && propertiesByName[key] !== p));
      const fileKey = clash ? name : key;
      names.file.set(name, fileKey);
      names.model.set(fileKey, name);
    }
  }
  byType.set(type, names);
  return names;
}

/** The key a file writes `type`'s property `name` (its local name) under; a name the type does not hold as it is. */
export function fileKey(metamodel: Metamodel, type: string, name: string): string {
  return namesOf(metamodel, type).file.get(name) ?? name;
}

/** The property a file's `key` on a `type` element names, by its local name; a key the type does not know as it is. */
export function modelKey(metamodel: Metamodel, type: string, key: string): string {
  return namesOf(metamodel, type).model.get(key) ?? key;
}

/** Whether `p` names another element of the file, which the file writes as `$id`: BPMN's references, and an attribute
 * typed by an element (a dataset's `schema`). */
export function isRefLike(metamodel: Metamodel, p: PropertyDef): boolean {
  return !!p.isReference || (!!p.isAttr && !BUILTIN_TYPES.has(p.type) && metamodel.has(p.type));
}

/** The marker a reference carries in the file. An id never holds it, since a BPMN id is an XML name. */
export const REF = '$';

/** A reference as the file writes it: `$id`; a list of one as its one id. */
export function refValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 1 ? refValue(value[0]) : value.map(refValue);
  return typeof value === 'string' ? `${REF}${value}` : value;
}

/** A reference as the study holds it: the id, its `$` taken off. */
export function refId(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(refId);
  return typeof value === 'string' && value.startsWith(REF) ? value.slice(REF.length) : value;
}
