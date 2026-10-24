/**
 * The `.studyflow.yaml` file as the study model (`./types.ts`) spells it: `readStudy` takes any spelling the file has
 * had (the short forms and the long ones), `writeStudy` writes the one the tools write. The short forms, each
 * reversible, are specified for authors in docs/reference.qmd, "The file", and pinned by
 * packages/core/tests/studyflow-yaml.unit.spec.ts.
 */
import * as yaml from 'js-yaml';
import { Document as YAMLDocument, isMap, isPair, isScalar, isSeq, visit, type Scalar, type YAMLMap, type YAMLSeq } from 'yaml';

import {
  DI_NODE_TYPES,
  YAML_DUMP_OPTIONS,
  compactDiNode,
  expandDiNode,
  expandInlineFlow,
  impliedTypeName,
  inlineYamlValue,
  isExpressionType,
  isYamlValueProperty,
  keyItemsById,
  keyedMapToList,
  longTypeName,
  shortTypeName,
  splitBinding,
} from '@core/model/spelling';
import { EVENT_KINDS, LOOP_KINDS, definitionId, fileKey, isRefLike, modelKey, refId, refValue } from '@core/model/names';
import { BUILTIN_TYPES, type Descriptor, type Metamodel, type PropertyDef } from '@core/model/metamodel';
import { isElement, type Drawing, type Element, type State, type Study, type Value } from '@core/model/types';

type Warn = (message: string) => void;

/** The keys of a file's top level that are not root elements. */
export const RESERVED_DOC_KEYS = new Set(['id', 'schemas', 'definitions', 'elements', 'layout', 'diagram', 'state']);

export type YamlDoc = Record<string, unknown>;

const DOCUMENTATION = 'bpmn:Documentation';
const STUDY = 'studyflow:Study';
const RUN_RECORD = 'prov:Activity';
/** The target namespace BPMN requires of every document, which a file leaves out unless it names another. */
const TARGET_NAMESPACE = 'http://bpmn.io/schema/bpmn';

/** Where a schema's typed element attaches (`cognitive:Questionnaire` → `bpmn:Task`): its own, or a type it inherits from. */
export function attachOf(metamodel: Metamodel, type: string, seen = new Set<string>()): string | undefined {
  const entry = metamodel.type(type);
  if (!entry || seen.has(type)) return undefined;
  seen.add(type);
  if (typeof entry.meta.attachesTo === 'string') return entry.meta.attachesTo;
  for (const parent of entry.superClass) {
    const found = attachOf(metamodel, parent.includes(':') ? parent : `${type.split(':')[0]}:${parent}`, seen);
    if (found) return found;
  }
  return undefined;
}

/** The BPMN type an element is: its own, or, for a schema's typed element, the one it attaches to. */
export function hostOf(metamodel: Metamodel, type: string): string {
  return type.startsWith('bpmn:') ? type : attachOf(metamodel, type) ?? type;
}

/** The property `key` of an element of `type`: its BPMN host's, then, for a typed element, its schema type's. */
export function propertyOf(metamodel: Metamodel, type: string, key: string): PropertyDef | undefined {
  const host = hostOf(metamodel, type);
  return metamodel.property(host, key) ?? (host === type ? undefined : metamodel.property(type, key));
}

function localKeys(descriptor: Descriptor): Set<string> {
  return new Set(descriptor.properties.map((p) => p.ns.localName));
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** An element in its long form, a BPMN element and its schema type's entry, as its schema type: what the file
 * spells and the reader reads. Unchanged when the entry cannot fold (another schema type, or keys the element holds). */
export function foldTyped(metamodel: Metamodel, element: Element): Element {
  const entries = element.extensionElements;
  if (!Array.isArray(entries)) return element;
  const typed = entries.filter((entry): entry is Element => isElement(entry) && attachOf(metamodel, entry.type) === element.type);
  if (typed.length !== 1) return element;
  const [entry] = typed;
  const own = localKeys(metamodel.descriptor(element.type));
  const keys = Object.keys(entry).filter((key) => key !== 'type');
  if (keys.some((key) => own.has(key) || key in element || key.includes(':'))) return element;
  const rest = entries.filter((other) => other !== entry);
  const folded: Element = { ...element, type: entry.type };
  delete folded.extensionElements;
  for (const key of keys) folded[key] = entry[key];
  if (rest.length > 0) folded.extensionElements = rest;
  return folded;
}

/* --- reading --- */

/** The definition an event's `key` names, when it is the key of a kind: its id the event's with `_Def`, unless the
 * mapping names another; `true` holding nothing; a value the kind's main attribute. */
function definitionOf(key: string, value: unknown, eventId: unknown): Record<string, unknown> | undefined {
  const type = Object.keys(EVENT_KINDS).find((candidate) => EVENT_KINDS[candidate].key === key);
  if (!type) return undefined;
  const id = typeof eventId === 'string' ? { id: definitionId(eventId) } : {};
  const { main } = EVENT_KINDS[type];
  if (value === true) return { type, ...id };
  if (isMapping(value)) return { type, ...id, ...value };
  return main ? { type, ...id, [main]: value } : undefined;
}

/** Whether `value`, under a prefixed key, is an entry of that type, or several: a mapping, or a list of mappings. */
function isEntryValue(value: unknown): value is Record<string, unknown> | Record<string, unknown>[] {
  return isMapping(value) || (Array.isArray(value) && value.length > 0 && value.every(isMapping));
}

/** The entries written under `type`, their prefixed key: one as its mapping, several as a list, each with its type. */
function entriesOf(type: string, value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : [value]).filter(isMapping).map((body) => ({ type, ...body }));
}

/** Whether `value`, an element's `extensions`, keys its entries by their prefixed types, as the file writes them. */
function isKeyedEntries(value: unknown): value is Record<string, unknown> {
  return isMapping(value) && Object.keys(value).every((key) => key.includes(':'));
}

/** The entries of an element's `extensions`, in the order written: BPMN's one list as it is, each with its `type`, or
 * each under its type. */
function entriesIn(value: unknown[] | Record<string, unknown>): unknown[] {
  return Array.isArray(value) ? value : Object.entries(value).flatMap(([type, body]) => entriesOf(type, body));
}

/** A line of the file's layout as the drawing it is: a box or a route alone as its text, a mapping's keys BPMN's. */
function layoutDrawing(metamodel: Metamodel, line: unknown): Record<string, unknown> | undefined {
  if (typeof line === 'string') return { [line.includes(',') ? 'waypoint' : 'bounds']: line };
  if (!isMapping(line)) return undefined;
  const diType = 'waypoint' in line ? 'bpmndi:BPMNEdge' : 'bpmndi:BPMNShape';
  return Object.fromEntries(Object.entries(line).map(([key, value]) => [modelKey(metamodel, diType, key), value]));
}

class Reader {
  readonly layout: Record<string, Drawing> = {};
  private readonly ids = new Map<string, Element>();
  private readonly references: { element: Element; key: string; many: boolean; context: string }[] = [];

  private readonly metamodel: Metamodel;
  private readonly warn: Warn;
  /** What the definitions declare, the namespaces of foreign elements among it. */
  private readonly namespaces: Record<string, unknown>;
  /** Whether a drawing written on an element moves to the layout: not in diagram interchange, which is drawing itself. */
  private readonly drawings: boolean;

  constructor(metamodel: Metamodel, warn: Warn, namespaces: Record<string, unknown>, drawings = true) {
    this.metamodel = metamodel;
    this.warn = warn;
    this.namespaces = namespaces;
    this.drawings = drawings;
  }

  /** `raw`, a file's node, where `declared` is expected. */
  element(raw: Record<string, unknown>, declared: string | undefined): Element {
    let node = raw;
    let type: string;
    let typed: string | undefined;
    const spelled = typeof node.type === 'string' ? node.type : undefined;
    if (spelled?.includes(':') && declared?.startsWith('bpmn:') && attachOf(this.metamodel, longTypeName(spelled))) {
      typed = longTypeName(spelled);
      type = typed;
    } else {
      const { type: _type, ...props } = node;
      const name = spelled ?? impliedTypeName(props, declared) ?? declared;
      if (!name) throw new Error(`Element is missing a 'type': ${JSON.stringify(raw).slice(0, 120)}`);
      type = longTypeName(name);
      if (!this.metamodel.has(type)) {
        // An element of a namespace no loaded schema declares but the definitions do (BPMN XML's foreign extensions)
        // is kept as written: its attributes and its child elements' texts. Any other type is a mistake.
        const prefix = type.split(':')[0];
        if (this.metamodel.package(prefix) || typeof this.namespaces[`xmlns:${prefix}`] !== 'string') throw new Error(`unknown type <${type}>`);
        return { ...(node as Record<string, Value>), type };
      }
    }
    const host = typed ? attachOf(this.metamodel, typed)! : type;
    const own = this.metamodel.descriptor(host);
    const wrapper = typed ? this.metamodel.descriptor(typed) : undefined;
    node = { ...node };
    delete node.type;
    node = this.longForm(node, host);
    if (DI_NODE_TYPES.has(type)) expandDiNode(node);

    const element: Element = { type };
    if (this.drawings) this.inlineDrawing(node, own, host);
    for (const [key, raw] of Object.entries(node)) {
      if (raw === undefined || raw === null) continue;
      const p = own.propertiesByName[key] ?? (wrapper && !own.propertiesByName[key] ? wrapper.propertiesByName[key] : undefined);
      if (!p) {
        element[key] = raw as Value;
        // A key in a namespace no loaded schema owns is foreign by design. A bare key is likely a typo, and so is one a
        // loaded schema does not declare.
        if (!key.includes(':')) this.warn(`unknown key '${key}' on ${type} kept as a raw attribute (typo, or its schema is not loaded?)`);
        else if (this.metamodel.package(key.split(':')[0])) this.warn(`unknown attribute <${key}> on ${type}`);
        continue;
      }
      this.property(element, p, raw);
    }
    if (typeof element.id === 'string' && element.id) {
      if (this.ids.has(element.id)) this.warn(`the id '${element.id}' names two elements; a reference to it reaches only the last`);
      this.ids.set(element.id, element);
    }
    return typed ? element : foldTyped(this.metamodel, element);
  }

  /** A node in the file's spelling as BPMN spells it: each key under its property's name, the entries written under
   * their types in `extensions` (or straight on the element) back in the one list, in the order written, an event's
   * kind as its definition, an activity's marker as the marker, an input's parameter back in its transformation. A key
   * no property of `host` holds stays as it is. */
  private longForm(node: Record<string, unknown>, host: string): Record<string, unknown> {
    const own = this.metamodel.descriptor(host).propertiesByName;
    const out: Record<string, unknown> = {};
    const entries: unknown[] = [];
    for (const [key, value] of Object.entries(node)) {
      const name = modelKey(this.metamodel, host, key);
      const definition = own.eventDefinitions && !own[name] ? definitionOf(key, value, node.id) : undefined;
      const marker = own.loopCharacteristics && !own[name] ? Object.keys(LOOP_KINDS).find((type) => LOOP_KINDS[type] === key) : undefined;
      if (name === 'extensionElements' && own[name] && (Array.isArray(value) || isKeyedEntries(value))) entries.push(...entriesIn(value));
      else if (own[name]) out[name] = value;
      else if (definition) out.eventDefinitions = [definition];
      else if (marker) out.loopCharacteristics = { type: marker, ...(isMapping(value) ? value : {}) };
      else if (key.includes(':') && isEntryValue(value)) entries.push(...entriesOf(key, value));
      else out[key] = value;
    }
    if (entries.length > 0) out.extensionElements = entries;
    if (host === 'bpmn:DataInputAssociation' && typeof out.parameter === 'string') {
      out.transformation = typeof out.transformation === 'string' ? `${out.parameter} = ${out.transformation}` : out.parameter;
      delete out.parameter;
    }
    return out;
  }

  /** `raw`, the file's value of `element`'s property `p`, read onto `element` under the property's local name: a
   * reference without the `$` it is written with. */
  property(element: Element, p: PropertyDef, raw: unknown): void {
    const name = p.ns.localName;
    if (p.isReference) {
      element[name] = (p.isMany ? (Array.isArray(raw) ? raw : [raw]).map((id) => String(refId(id))) : String(refId(raw))) as Value;
      this.references.push({ element, key: name, many: !!p.isMany, context: element.type });
      return;
    }
    if (isRefLike(this.metamodel, p)) raw = refId(raw);
    if (p.isMany) {
      const list = Array.isArray(raw) ? raw as unknown[]
        : typeof raw === 'string' && p.type === DOCUMENTATION ? [raw]
        : keyedMapToList(raw);
      element[name] = list.map((item) => this.value(expandInlineFlow(item), p.type));
      return;
    }
    element[name] = isYamlValueProperty(p) ? yamlValue(raw) : this.value(raw, p.type);
  }

  /** What `raw` is where a `declared` value is expected: an element, an expression's text, a list, or itself. */
  private value(raw: unknown, declared: string | undefined): Value {
    const elementType = !!declared && !BUILTIN_TYPES.has(declared);
    if (Array.isArray(raw)) {
      const list = elementType ? elementList(this.metamodel, declared!) : undefined;
      return list ? raw.map((item) => this.value(item, list.type)) : raw as Value;
    }
    if (isMapping(raw)) {
      if (!('type' in raw) && !elementType) return raw as Value;
      return this.simplified(this.element(raw, declared));
    }
    return raw as Value;
  }

  /** An element as the file writes it: an expression or documentation of nothing but its text as the text, a list
   * holder as its list. */
  private simplified(element: Element): Value {
    const key = isExpressionType(element.type) ? 'body' : element.type === DOCUMENTATION ? 'text' : undefined;
    const text = key ? element[key] : undefined;
    if (typeof text === 'string' && text !== '' && Object.keys(element).every((other) => other === 'type' || other === key)) return text;
    const list = elementList(this.metamodel, element.type);
    if (list && Object.keys(element).every((key) => key === 'type' || key === list.ns.localName)) {
      const items = element[list.ns.localName];
      if (Array.isArray(items) && items.length > 0) return items;
    }
    return element;
  }


  /** The drawing written on an element (`bounds`, `waypoint`, colours), moved to the layout: its colours too when
   * its geometry is the layout's, or when it has none yet. */
  private inlineDrawing(node: Record<string, unknown>, own: Descriptor, host: string): void {
    const id = typeof node.id === 'string' ? node.id : undefined;
    const diType = 'bounds' in node && !own.propertiesByName.bounds ? 'bpmndi:BPMNShape'
      : 'waypoint' in node && !own.propertiesByName.waypoint ? 'bpmndi:BPMNEdge' : diTypeOf(this.metamodel, host);
    const di = this.metamodel.descriptor(diType).propertiesByName;
    const drawing: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      if (key === 'id' || own.propertiesByName[key] || !di[key]) continue;
      drawing[key] = node[key];
      delete node[key];
    }
    if (id && Object.keys(drawing).length > 0) this.drawn(id, diType, drawing);
  }

  /** `drawing`, as the file writes it, kept as `id`'s, over what the element itself wrote of it. */
  drawn(id: string, diType: string, drawing: Record<string, unknown>): void {
    this.layout[id] = canonicalDrawing(this.metamodel, diType, { ...this.layout[id], ...drawing });
  }

  /** The type of the element `id` names, when the file holds one. */
  typeOf(id: string): string | undefined {
    return this.ids.get(id)?.type;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** References to ids the file does not hold are left out, with a warning, as the BPMN reader leaves them out. */
  resolve(): void {
    for (const { element, key, many, context } of this.references) {
      const ids = (many ? element[key] as string[] : [element[key] as string]).filter((id) => {
        if (this.ids.has(id)) return true;
        this.warn(`${context}#${key} names '${id}', which no element is; left out`);
        return false;
      });
      if (many) element[key] = ids;
      else if (ids.length > 0) element[key] = ids[0];
      else delete element[key];
    }
  }
}

/** The one list a BPMN list holder holds (`extensionElements`'s `values`): a schema's element with one list is an entry. */
export function elementList(metamodel: Metamodel, type: string): PropertyDef | undefined {
  if (!metamodel.has(type)) return undefined;
  const descriptor = metamodel.descriptor(type);
  if (descriptor.ns.prefix !== 'bpmn') return undefined;
  const content = descriptor.properties.filter((p) => !p.isAttr && !p.isReference && !p.isBody);
  return content.length === 1 && content[0].isMany ? content[0] : undefined;
}

/** A YAML-typed attribute as the file writes it: its mapping when the text is one and may carry no comment, else its
 * text. The attribute holds text, so a value of another kind (a list, a number, a mapping with a `type`) is its text. */
function yamlValue(raw: unknown): Value {
  const text = typeof raw === 'string' ? raw : yaml.dump(raw, YAML_DUMP_OPTIONS);
  return (inlineYamlValue(text, { type: 'YAMLString' }) ?? text) as Value;
}

/** A drawing in the file's spelling and key order: the diagram element's properties in order, one line of geometry,
 * one key per colour. */
export function canonicalDrawing(metamodel: Metamodel, diType: string, drawing: Record<string, unknown>): Drawing {
  const expanded = { ...drawing };
  expandDiNode(expanded);
  const ordered: Record<string, unknown> = {};
  const taken = new Set<string>();
  for (const p of metamodel.descriptor(diType).properties) {
    // Written under its local name, as every property is; a colour's two vocabularies fold to one key below.
    const key = [p.ns.localName, p.ns.name].find((candidate) => candidate in expanded);
    if (key === undefined || p.ns.localName in ordered) continue;
    ordered[p.ns.localName] = expanded[key];
    taken.add(key);
  }
  for (const [key, value] of Object.entries(expanded)) if (!taken.has(key) && !(key in ordered)) ordered[key] = value;
  compactDiNode(ordered);
  return ordered as Drawing;
}

/** How an element of `host` is drawn: a route for a flow, a box for the rest. */
function diTypeOf(metamodel: Metamodel, host: string): string {
  const routed = ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataAssociation'];
  return routed.some((type) => metamodel.isA(host, type)) ? 'bpmndi:BPMNEdge' : 'bpmndi:BPMNShape';
}

/** A study from its file: the text, or a document already parsed (a schema template's elements). */
export function readStudy(source: string | YamlDoc, metamodel: Metamodel, warn: Warn = (message) => console.warn(`[studyflow read] ${message}`)): Study {
  const doc = (typeof source === 'string' ? yaml.load(source) : source) as YamlDoc;
  if (!isMapping(doc) || !('schemas' in doc || 'definitions' in doc)) throw new Error("Not a studyflow YAML document (missing 'schemas').");
  const definitions: Record<string, Value> = { ...(doc.definitions as Record<string, Value> ?? {}) };
  // A schema a loaded package declares is the package's; any other the definitions declare, so its elements are kept.
  for (const [prefix, uri] of Object.entries(isMapping(doc.schemas) ? doc.schemas : {})) {
    if (typeof uri === 'string' && metamodel.package(prefix)?.uri !== uri) definitions[`xmlns:${prefix}`] = uri;
  }
  definitions.targetNamespace ??= TARGET_NAMESPACE;
  const reader = new Reader(metamodel, warn, definitions);
  const id = doc.id ?? definitions.id;
  delete definitions.id;
  // What the definitions hold besides their attributes (documentation, imports, extension elements) reads as an
  // element's would.
  const holder: Element = { type: 'bpmn:Definitions' };
  for (const p of metamodel.descriptor('bpmn:Definitions').properties) {
    const raw = definitions[p.ns.localName];
    if (raw === undefined || raw === null || p.isReference || BUILTIN_TYPES.has(p.type)) continue;
    reader.property(holder, p, raw);
    definitions[p.ns.localName] = holder[p.ns.localName]!;
  }
  const raws: unknown[] = [];
  for (const [key, body] of Object.entries(doc)) {
    if (RESERVED_DOC_KEYS.has(key)) continue;
    if (!isMapping(body)) {
      warn(`top-level key '${key}' is not an element and was ignored`);
      continue;
    }
    raws.push(...keyedMapToList({ [key]: body }));
  }
  if (Array.isArray(doc.elements)) raws.push(...doc.elements);
  else if (doc.elements) raws.push(...keyedMapToList(doc.elements));
  const roots = raws.map((raw) => reader.element(expandInlineFlow(raw) as Record<string, unknown>, 'bpmn:RootElement'));
  if (typeof source === 'string') {
    for (const root of roots) {
      if (metamodel.isA(hostOf(metamodel, root.type), 'bpmn:RootElement')) continue;
      warn(`unrecognized element <${root.type}>${root.id ? ` '${root.id}'` : ''} at the top level, which holds only root elements such as a process or a collaboration`);
    }
  }
  if (isMapping(doc.layout)) {
    for (const [elementId, line] of Object.entries(doc.layout)) {
      const type = reader.typeOf(elementId);
      const drawing = layoutDrawing(metamodel, line);
      if (!type || !drawing) {
        warn(`layout draws '${elementId}', which no element is; left out`);
        continue;
      }
      // A drawing with no geometry yet holds the look a route or a box will take when it is drawn.
      const diType = 'bounds' in drawing ? 'bpmndi:BPMNShape' : 'waypoint' in drawing ? 'bpmndi:BPMNEdge' : diTypeOf(metamodel, hostOf(metamodel, type));
      reader.drawn(elementId, diType, drawing as Record<string, unknown>);
    }
  }
  const diagram = Array.isArray(doc.diagram) ? readDiagrams(doc.diagram, reader, metamodel, definitions) : undefined;
  reader.resolve();
  const study: Study = { ...(id === undefined ? {} : { id: String(id) }), definitions, roots, layout: reader.layout };
  if (diagram && diagram.length > 0) study.diagram = diagram;
  if (isMapping(doc.state)) study.state = doc.state as State;
  impliedFlowLists(study, metamodel);
  return study;
}

/** A diagram in the file's spelling, as a study holds it (`study.diagram`), as an element. Read by a reader of its own:
 * its ids are not the study's elements', and its references (to its own shapes too) stay the ids they name. */
export function diagramElement(raw: Record<string, unknown>, metamodel: Metamodel, namespaces: Record<string, unknown>): Element {
  return new Reader(metamodel, () => {}, namespaces, false).element(raw, 'bpmndi:BPMNDiagram');
}

/** A diagram section as the study holds it, each diagram an element: each plane element of the first that the layout
 * can hold moves to it, read off the diagram as the file spells it; the rest, and a diagram that says more than which
 * root it draws, stay. */
function readDiagrams(raws: unknown[], reader: Reader, metamodel: Metamodel, namespaces: Record<string, unknown>): Value[] {
  const kept: Value[] = [];
  raws.forEach((raw, index) => {
    if (!isMapping(raw)) return;
    const diagram = diagramElement(raw, metamodel, namespaces);
    const plane = isElement(diagram.plane) ? diagram.plane : undefined;
    if (plane && index === 0) {
      const spelled = spelledElement(metamodel, diagram, 'bpmndi:BPMNDiagram').plane as Record<string, unknown> | undefined;
      const elements = keyedMapToList(spelled?.planeElement);
      const targetOf = (pe: Record<string, unknown>): unknown => refId(pe.bpmnElement);
      const counts = new Map<string, number>();
      for (const pe of elements) {
        const target = isMapping(pe) ? targetOf(pe) : undefined;
        if (typeof target === 'string') counts.set(target, (counts.get(target) ?? 0) + 1);
      }
      const moved = new Set<unknown>();
      for (const pe of elements) {
        if (!isMapping(pe)) continue;
        const type = typeof pe.type === 'string' ? longTypeName(pe.type) : undefined;
        const target = targetOf(pe);
        if (!type || !DI_NODE_TYPES.has(type) || typeof target !== 'string' || counts.get(target) !== 1 || !reader.has(target)) continue;
        const { type: _type, id, bpmnElement: _ref, ...written } = pe;
        // The drawing under BPMN's keys, as the layout holds it.
        const drawing = Object.fromEntries(Object.entries(written).map(([key, value]) => [modelKey(metamodel, type, key), value]));
        if (Object.keys(drawing).some((key) => ['sourceElement', 'targetElement', 'choreographyActivityShape'].includes(key))) continue;
        reader.drawn(target, type, drawing);
        moved.add(id);
      }
      const rest = (Array.isArray(plane.planeElement) ? plane.planeElement : []).filter((pe) => !(isElement(pe) && moved.has(pe.id)));
      if (rest.length > 0) plane.planeElement = rest;
      else delete plane.planeElement;
    }
    kept.push(diagram);
  });
  return kept;
}

/** `incoming` and `outgoing` lists that say only what the sequence flows say: the file leaves them out. */
function impliedFlowLists(study: Study, metamodel: Metamodel): void {
  const visit = (container: Element): void => {
    const children = (container.flowElements as Value[] | undefined) ?? [];
    const flows = children.filter((child): child is Element => isElement(child) && metamodel.isA(hostOf(metamodel, child.type), 'bpmn:SequenceFlow'));
    for (const child of children) {
      if (!isElement(child)) continue;
      for (const [key, end] of [['incoming', 'targetRef'], ['outgoing', 'sourceRef']] as const) {
        const listed = child[key];
        if (!Array.isArray(listed)) continue;
        const implied = flows.filter((flow) => flow[end] === child.id).map((flow) => flow.id);
        if (implied.length === listed.length && implied.every((id, i) => id === listed[i])) delete child[key];
      }
      visit(child);
    }
  };
  study.roots.forEach(visit);
}

/* --- writing --- */

/** What the file keeps of an element, in the order it writes it: each property in its type's order (a typed element's
 * schema attributes where its schema's entry would stand), then the keys no schema declares; none that holds nothing
 * or its default, no reference to an id the study does not hold, and no Study's run state. */
class Writer {
  /** The ids of the elements written, in the order the file writes them: the layout map's order. */
  readonly order: string[] = [];

  private readonly metamodel: Metamodel;
  /** The ids a reference may name: one naming any other is left out. */
  private readonly held: { has(id: string): boolean };
  private readonly warn?: Warn;

  constructor(metamodel: Metamodel, held: { has(id: string): boolean }, warn?: Warn) {
    this.metamodel = metamodel;
    this.held = held;
    this.warn = warn;
  }

  element(element: Element): Element {
    const out: Element = { type: element.type };
    if (typeof element.id === 'string') this.order.push(element.id);
    const host = hostOf(this.metamodel, element.type);
    const own = this.metamodel.has(host) ? this.metamodel.descriptor(host) : undefined;
    const wrapper = host === element.type ? undefined : this.metamodel.descriptor(element.type);
    const written = new Set(['type']);
    for (const p of own?.properties ?? []) {
      const key = p.ns.localName;
      written.add(key);
      if (key === 'extensionElements' && wrapper) {
        // A typed element's schema attributes stand where its schema's entry would.
        for (const wp of wrapper.properties) {
          const wkey = wp.ns.localName;
          if (localKeys(own!).has(wkey)) continue;
          written.add(wkey);
          this.property(out, element, wp, wkey);
        }
      }
      this.property(out, element, p, key);
    }
    for (const [key, value] of Object.entries(element)) {
      if (!written.has(key) && value !== undefined && !wrapper?.propertiesByName[key]) out[key] = value;
    }
    return out;
  }

  /** `element`'s property `p`, kept in `out` under `key` when the file writes it. */
  property(out: Record<string, Value | undefined>, element: Element, p: PropertyDef, key: string): void {
    const value = element[key];
    if (value === undefined || value === null) return;
    if (p.default !== undefined && value === p.default) return;
    // The run state is the file's own `state:`, not a property of the study.
    if (key === 'state' && element.type === STUDY) return;
    if (p.isReference) {
      const ids = (p.isMany ? value as string[] : [value as string]).filter((id) => {
        if (this.held.has(id)) return true;
        this.warn?.(`'${element.id ?? element.type}' refers by ${key} to '${id}', which the document does not hold; the reference was left out`);
        return false;
      });
      if (p.isMany ? ids.length > 0 : ids.length === 1) out[key] = p.isMany ? ids : ids[0];
      return;
    }
    if (p.isMany) {
      if (!Array.isArray(value) || value.length === 0) return;
      out[key] = value.map((item) => this.value(item, p.type));
      return;
    }
    // YAML an edit wrote as text is written as the mapping the reader makes of it, so a save after an edit spells it
    // as a save after a reload does.
    if (isYamlValueProperty(p) && typeof value === 'string') {
      out[key] = (inlineYamlValue(value, p) ?? value) as Value;
      return;
    }
    out[key] = this.value(value, p.type);
  }

  private value(value: Value, declared: string | undefined): Value {
    if (Array.isArray(value)) {
      const list = declared && elementList(this.metamodel, declared);
      return list ? value.map((item) => this.value(item, list.type)) : value;
    }
    if (isElement(value)) return this.element(value);
    return value;
  }
}


/**
 * An element the {@link Writer} keeps, in the file's spelling (docs/reference.qmd, "The file"). It is written as BPMN
 * holds it: a schema's typed element as its BPMN type with an entry of the schema's type (a choreography task in a
 * process keeps its type and its bands; the BPMN XML alone writes it as a task marked an exchange, `@core/document`).
 * Each key is its file name ({@link fileKey}), a reference `$id`, its entries under `extensions`, each under its
 * prefixed type, an event's one definition and an activity's
 * marker under their kinds, an edge's two ends as two keys. Its type is left out where the key holding it says it, then
 * come its name, its attributes, its `extensions`, its documentation, and last the lists of elements it holds, keyed by id.
 */
class Speller {
  private readonly metamodel: Metamodel;

  constructor(metamodel: Metamodel) {
    this.metamodel = metamodel;
  }

  /** `element` where a `declared` element is expected; an `entry` among an element's extension entries, which is no
   * BPMN element, as it is. */
  element(element: Element, declared: string | undefined, entry = false): Record<string, unknown> {
    const el = entry ? element : this.asBpmn(element);
    const type = el.type;
    const own = this.metamodel.has(type) ? this.metamodel.descriptor(type).propertiesByName : undefined;
    const head: Record<string, unknown> = {};
    const attributes: Record<string, unknown> = {};
    const prose: Record<string, unknown> = {};
    const held: Record<string, unknown> = {};
    let entries: Value[] | undefined;
    if (type !== declared) head.type = shortTypeName(type);
    for (const [key, value] of Object.entries(el)) {
      const p = own?.[key];
      if (key === 'type' || value === undefined) continue;
      if (!p) attributes[key] = value;
      else if (key === 'id' || key === 'name') head[key] = value;
      else if (key === 'extensionElements' && Array.isArray(value)) entries = value;
      else if (key === 'documentation' && Array.isArray(value)) prose.documentation = this.documentation(value);
      else if (!this.kind(el, key, value, attributes)) this.property(type, p, value, isListOfElements(p, value) ? held : attributes);
    }
    if (type === 'bpmn:DataInputAssociation') splitParameter(attributes);
    const extensions = entries && entries.length > 0 ? { [fileKey(this.metamodel, type, 'extensionElements')]: this.entries(entries) } : {};
    const out = { ...head, ...attributes, ...extensions, ...prose, ...held };
    if (DI_NODE_TYPES.has(type)) compactDiNode(out);
    if (out.type !== undefined && impliedTypeName(out, declared) === type) delete out.type;
    return out;
  }

  /** `element` as BPMN holds it: a schema's typed element as its BPMN type, an entry of the schema's type first among
   * its entries. */
  private asBpmn(element: Element): Element {
    const host = hostOf(this.metamodel, element.type);
    if (host === element.type || !this.metamodel.has(element.type)) return element;
    const hostOwn = this.metamodel.descriptor(host).propertiesByName;
    const typedOwn = this.metamodel.descriptor(element.type).propertiesByName;
    const bpmn: Element = { type: host };
    const entry: Element = { type: element.type };
    for (const [key, value] of Object.entries(element)) {
      if (key === 'type') continue;
      if (!hostOwn[key] && typedOwn[key]) entry[key] = value;
      else bpmn[key] = value;
    }
    bpmn.extensionElements = [entry, ...(Array.isArray(element.extensionElements) ? element.extensionElements : [])];
    return bpmn;
  }

  /** `value`, `element`'s property `p`, under its file key in `out`. */
  private property(type: string, p: PropertyDef, value: Value, out: Record<string, unknown>): void {
    const key = fileKey(this.metamodel, type, p.ns.localName);
    if (isRefLike(this.metamodel, p)) out[key] = refValue(value);
    else if (isListOfElements(p, value)) {
      const items = (value as Value[]).map((item) => this.value(item, p.type));
      out[key] = keyItemsById(items) ?? items;
    } else out[key] = this.value(value, p.type);
  }

  /** An event's one definition, or an activity's marker, under the key of its kind in `out`; whether it was one. */
  private kind(el: Element, key: string, value: Value, out: Record<string, unknown>): boolean {
    const own = this.metamodel.descriptor(el.type).propertiesByName;
    if (key === 'eventDefinitions' && Array.isArray(value) && value.length === 1 && isElement(value[0]) && typeof value[0].id === 'string') {
      const definition = value[0];
      const kind = EVENT_KINDS[definition.type];
      if (!kind || own[kind.key]) return false;
      const body = this.element(definition, definition.type);
      if (typeof el.id === 'string' && body.id === definitionId(el.id)) delete body.id;
      const main = kind.main && fileKey(this.metamodel, definition.type, kind.main);
      const keys = Object.keys(body);
      if (keys.length === 0) out[kind.key] = true;
      else if (keys.length === 1 && keys[0] === main && ['string', 'number'].includes(typeof body[main])) out[kind.key] = body[main];
      else out[kind.key] = body;
      return true;
    }
    if (key === 'loopCharacteristics' && isElement(value) && LOOP_KINDS[value.type] && !own[LOOP_KINDS[value.type]]) {
      const body = this.element(value, value.type);
      out[LOOP_KINDS[value.type]] = Object.keys(body).length === 0 ? true : body;
      return true;
    }
    return false;
  }

  /** An element's entries, what its `extensions` hold: each under its type, one as its mapping, `{}` when it holds
   * nothing, several of one type as a list, the run records always a list so the next run adds a line. Where types
   * interleave, which keying by type would reorder, or an entry has none, BPMN's one list, each entry with its type. */
  private entries(values: Value[]): Record<string, unknown> | unknown[] {
    const types = values.map((value) => (isElement(value) ? value.type : undefined));
    const runs = types.filter((type, index) => index === 0 || types[index - 1] !== type);
    if (types.some((type) => type === undefined) || new Set(runs).size !== runs.length) {
      return values.map((value) => (isElement(value) ? this.element(value, undefined, true) : value));
    }
    const out: Record<string, unknown> = {};
    values.forEach((value, index) => {
      const type = types[index]!;
      const body = this.element(value as Element, type, true);
      if (type === RUN_RECORD) ((out[type] ??= []) as unknown[]).push(body);
      else if (!(type in out)) out[type] = body;
      else out[type] = [...(Array.isArray(out[type]) ? out[type] as unknown[] : [out[type]]), body];
    });
    return out;
  }

  private documentation(list: Value[]): unknown {
    if (list.every((item) => typeof item === 'string')) return list.length === 1 ? list[0] : list;
    return list.map((item) => (typeof item === 'string' ? { text: item } : this.value(item, DOCUMENTATION)));
  }

  private value(value: Value, declared: string | undefined): unknown {
    if (Array.isArray(value)) {
      const list = declared && elementList(this.metamodel, declared);
      return list ? value.map((item) => this.value(item, list.type)) : value.map((item) => (isElement(item) ? this.element(item, declared) : item));
    }
    if (isElement(value)) return this.element(value, declared);
    return value;
  }
}

/** Whether `value`, a property's, is a list of elements, which the file writes keyed by id. */
function isListOfElements(p: PropertyDef, value: Value): boolean {
  return !!p.isMany && !p.isReference && p.type !== DOCUMENTATION && Array.isArray(value) && value.some(isElement);
}

/** An input's transformation, `parameter = selection`, as its two keys, where the text is just that. */
function splitParameter(attributes: Record<string, unknown>): void {
  const text = attributes.transformation;
  if (typeof text !== 'string') return;
  const { slot, selection } = splitBinding(text);
  if (!slot || (selection === undefined ? slot : `${slot} = ${selection}`) !== text) return;
  const entries = Object.entries(attributes).flatMap(([key, value]): [string, unknown][] => (key !== 'transformation' ? [[key, value]]
    : [['parameter', slot], ...(selection === undefined ? [] : [['transformation', selection] as [string, unknown]])]));
  for (const key of Object.keys(attributes)) delete attributes[key];
  Object.assign(attributes, Object.fromEntries(entries));
}

/** `element` as the file spells it where a `declared` element is expected, by a writer of its own that keeps every
 * reference. */
export function spelledElement(metamodel: Metamodel, element: Element, declared?: string): Record<string, unknown> {
  return new Speller(metamodel).element(new Writer(metamodel, { has: () => true }).element(element), declared);
}

/** Every id the study's elements hold. */
function heldIds(study: Study): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isElement(value)) {
      if (typeof value.id === 'string') ids.add(value.id);
      Object.values(value).forEach(visit);
    }
  };
  study.roots.forEach(visit);
  return ids;
}

/** Whether `name`, a definitions' namespace declaration, is one the BPMN writer restores on its own. */
function redundantNamespace(metamodel: Metamodel, name: string, value: Value): boolean {
  if (!name.startsWith('xmlns:')) return false;
  const prefix = name.slice('xmlns:'.length);
  if (prefix === 'xsi') return true;
  return metamodel.packages.some((pkg) => pkg.prefix === prefix || (typeof value === 'string' && pkg.uri === value));
}

/** A collaboration with no pool, only actors that take bands: it holds participants for the process and draws nothing. */
export function isHeadlessCollaboration(root: Element): boolean {
  return root.type === 'bpmn:Collaboration'
    && !((root.participants as Value[] | undefined) ?? []).some((p) => isElement(p) && p.processRef !== undefined);
}

/** The root a study whose drawing names none draws: the first collaboration with a pool, then the first process, then
 * the first choreography; else the first root with an id. */
export function inferredRoot(study: Study, metamodel: Metamodel): Element | undefined {
  for (const type of ['bpmn:Collaboration', 'bpmn:Process', 'bpmn:Choreography']) {
    const root = study.roots.find((candidate) => metamodel.isA(hostOf(metamodel, candidate.type), type) && !isHeadlessCollaboration(candidate));
    if (root) return root;
  }
  return study.roots.find((root) => typeof root.id === 'string');
}

/** A diagram that only says which root it draws, when that is the root the reader infers, or a collaboration with no
 * pool (which draws that same root): the file leaves it out. */
function redundantDiagram(node: Value, study: Study, metamodel: Metamodel): boolean {
  if (!isMapping(node) || Object.keys(node).some((key) => !['type', 'id', 'plane'].includes(key))) return false;
  const plane = node.plane;
  if (!isMapping(plane)) return true;
  if (Object.keys(plane).some((key) => !['type', 'id', 'bpmnElement'].includes(key))) return false;
  const named = refId(plane.bpmnElement);
  return named === undefined || named === inferredRoot(study, metamodel)?.id
    || study.roots.some((root) => root.id === named && isHeadlessCollaboration(root));
}

/** The study as its file holds it, what its YAML and its BPMN XML are both written from: the definitions without the
 * namespaces the BPMN writer restores itself, each root as the {@link Writer} keeps it, the drawing of each element
 * written in the order it is written, the diagram unless it says only which root the reader infers anyway, and the
 * run state. `warn` hears each reference left out. */
export function writtenStudy(study: Study, metamodel: Metamodel, warn?: Warn): Study {
  const writer = new Writer(metamodel, heldIds(study), warn);
  const definitions: Record<string, Value> = {};
  const own = metamodel.descriptor('bpmn:Definitions');
  const holder: Element = { ...study.definitions, type: 'bpmn:Definitions' };
  for (const p of own.properties) if (p.ns.localName !== 'id') writer.property(definitions, holder, p, p.ns.localName);
  for (const [key, value] of Object.entries(study.definitions)) {
    if (!(key in definitions) && !own.propertiesByName[key] && !redundantNamespace(metamodel, key, value)) definitions[key] = value;
  }
  const roots = study.roots.map((root) => writer.element(root));
  // Each drawing in the order its element is written, so the layout reads as the elements do.
  const layout = Object.fromEntries(writer.order.filter((id) => study.layout[id]).map((id) => [id, study.layout[id]]));
  const written: Study = { ...(study.id === undefined ? {} : { id: study.id }), definitions, roots, layout };
  const diagram = (study.diagram ?? []).filter((node, index, all) => !(index === 0 && all.length === 1 && redundantDiagram(node, study, metamodel)));
  if (diagram.length > 0) written.diagram = diagram;
  if (study.state && Object.keys(study.state).length > 0) written.state = study.state;
  return written;
}


/** Each namespace the written study uses besides BPMN's, prefix to URI: the types of its elements and entries, its
 * prefixed keys, a schema type an item definition names, and the core's, which every study uses; then the namespaces
 * the definitions declare for elements no loaded schema knows. */
function schemasOf(metamodel: Metamodel, written: Study): Record<string, string> {
  const prefixes = new Set(['studyflow']);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isElement(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (key.includes(':')) prefixes.add(key.split(':')[0]);
        if ((key === 'type' || key === 'structureRef') && typeof item === 'string' && item.includes(':') && !item.includes('://')) prefixes.add(item.split(':')[0]);
        visit(item);
      }
    }
  };
  written.roots.forEach(visit);
  const out: Record<string, string> = {};
  for (const prefix of [...prefixes].sort()) {
    const uri = metamodel.package(prefix)?.uri ?? written.definitions[`xmlns:${prefix}`];
    if (prefix !== 'bpmn' && typeof uri === 'string') out[prefix] = uri;
  }
  for (const [key, uri] of Object.entries(written.definitions)) {
    if (key.startsWith('xmlns:') && typeof uri === 'string') out[key.slice('xmlns:'.length)] = uri;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** A drawing as the file's layout writes it, one line: a shape's box or an edge's route alone as its text, anything
 * more as a mapping under the file's keys. */
function layoutLine(metamodel: Metamodel, drawing: Drawing): unknown {
  const keys = Object.keys(drawing);
  if (keys.length === 1 && (keys[0] === 'bounds' || keys[0] === 'waypoint') && typeof drawing[keys[0]] === 'string') return drawing[keys[0]];
  const diType = 'waypoint' in drawing ? 'bpmndi:BPMNEdge' : 'bpmndi:BPMNShape';
  return Object.fromEntries(Object.entries(drawing).map(([key, value]) => [fileKey(metamodel, diType, key), value]));
}

/** The study as its file's document: the structure the text the tools write holds ({@link studyText}). */
export function writeStudy(study: Study, metamodel: Metamodel, warn?: Warn): YamlDoc {
  const written = writtenStudy(study, metamodel, warn);
  const speller = new Speller(metamodel);
  const doc: YamlDoc = {};
  if (written.id !== undefined) doc.id = written.id;
  doc.schemas = schemasOf(metamodel, written);
  const { type: _type, ...definitions } = speller.element({ ...written.definitions, type: 'bpmn:Definitions' }, 'bpmn:Definitions');
  for (const key of Object.keys(definitions)) if (key.startsWith('xmlns:')) delete definitions[key];
  if (definitions.targetNamespace === TARGET_NAMESPACE) delete definitions.targetNamespace;
  if (Object.keys(definitions).length > 0) doc.definitions = definitions;
  const unkeyable: unknown[] = [];
  const roots = written.roots.map((root) => speller.element(root, 'bpmn:RootElement'));
  const keyed = keyItemsById(roots);
  if (!keyed) unkeyable.push(...roots);
  else {
    for (const [key, body] of Object.entries(keyed)) {
      if (!RESERVED_DOC_KEYS.has(key) && !(key in doc)) doc[key] = body;
      else unkeyable.push({ id: key, ...(body as object) });
    }
  }
  if (unkeyable.length > 0) doc.elements = unkeyable;
  if (Object.keys(written.layout).length > 0) {
    doc.layout = Object.fromEntries(Object.entries(written.layout).map(([id, drawing]) => [id, layoutLine(metamodel, drawing)]));
  }
  if (written.diagram) {
    doc.diagram = written.diagram.map((node) => speller.element(diagramElement(node as Record<string, unknown>, metamodel, written.definitions), 'bpmndi:BPMNDiagram'));
  }
  if (written.state) doc.state = written.state;
  return doc;
}

/** The keys whose mapping lists elements keyed by id, which the text separates by a blank line. */
const ELEMENT_LISTS = new Set(['elements', 'messageFlows', 'artifacts', 'properties', 'inputs', 'outputs', 'laneSets', 'lanes',
  'eventDefinitions', 'categoryValue', 'flowElements', 'participants', 'dataInputAssociations', 'dataOutputAssociations']);

/** The head of the file, which no blank line divides. */
const HEAD_KEYS = new Set(['id', 'schemas', 'definitions']);

const TEXT_OPTIONS = { lineWidth: 120, minContentWidth: 0, flowCollectionPadding: false } as const;

/** `node` written as if lines had no width, so nothing in it breaks across lines however long. */
function unbounded(node: YAMLMap | YAMLSeq): void {
  const write = node.toString.bind(node) as YAMLMap['toString'];
  (node as { toString: YAMLMap['toString'] }).toString = (ctx, ...rest) => write(ctx && { ...ctx, options: { ...ctx.options, lineWidth: 0 } }, ...rest);
}

/** The study as the text of its `.studyflow.yaml` file ({@link documentText}). */
export function studyText(study: Study, metamodel: Metamodel, warn?: Warn): string {
  return documentText(writeStudy(study, metamodel, warn));
}

/** `doc`, the document of a `.studyflow.yaml` file or a part of one, as its text: a blank line before each part of the
 * file after its head and between the elements of each list, each drawing and each run record on one line however
 * long, and prose too long for its line folded. YAML 1.1 quotes what any YAML reader could take for another type (a
 * date, `1:1`, `yes`). */
export function documentText(doc: YamlDoc): string {
  const document = new YAMLDocument(doc, { version: '1.1' });
  visit(document, {
    Pair(_, pair, path) {
      const map = path[path.length - 1];
      const holder = path[path.length - 2];
      if (!isMap(map) || !isScalar(pair.key)) return;
      const key = String(pair.key.value);
      const part = path.length === 2 ? pair : path[2];
      const drawing = isPair(part) && isScalar(part.key) && part.key.value === 'layout';
      if (path.length === 2 && drawing && isMap(pair.value)) unbounded(pair.value);
      // Prose too long for its line folds into a block, as a paragraph reads.
      const indent = 2 * (path.filter((node) => isMap(node) || isSeq(node)).length - 1);
      const text = isScalar(pair.value) ? pair.value.value : undefined;
      if (!map.flow && !drawing && typeof text === 'string' && !text.includes('\n') && indent + key.length + 2 + text.length > TEXT_OPTIONS.lineWidth) {
        (pair.value as Scalar).type = 'BLOCK_FOLDED';
      }
      if (map.items.indexOf(pair as never) === 0) return;
      const topLevel = path.length === 2 && !HEAD_KEYS.has(key);
      const listed = isPair(holder) && isScalar(holder.key) && ELEMENT_LISTS.has(String(holder.key.value)) && isMap(pair.value);
      if (topLevel || listed) pair.key.spaceBefore = true;
    },
    Map(_, map, path) {
      const holder = path[path.length - 1];
      const layout = path[path.length - 3];
      if (isPair(holder) && isPair(layout) && isScalar(layout.key) && layout.key.value === 'layout' && path.length === 5) map.flow = true;
    },
    Seq(_, seq, path) {
      const holder = path[path.length - 1];
      if (!isPair(holder) || !isScalar(holder.key) || holder.key.value !== RUN_RECORD) return;
      unbounded(seq);
      for (const item of seq.items) if (isMap(item)) item.flow = true;
    },
  });
  return document.toString(TEXT_OPTIONS);
}
