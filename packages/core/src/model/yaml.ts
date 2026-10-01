/**
 * The `.studyflow.yaml` file as the study model (`./types.ts`) spells it: `readStudy` takes any spelling the file has
 * had (the short forms and the long ones), `writeStudy` writes the one the tools write. The short forms, each
 * reversible, are specified for authors in docs/reference.qmd, "The file", and pinned by
 * packages/core/tests/studyflow-yaml.unit.spec.ts.
 */
import * as yaml from 'js-yaml';

import {
  DI_NODE_TYPES,
  YAML_DUMP_OPTIONS,
  compactDiNode,
  expandDiNode,
  expandInline,
  expandInlineFlow,
  impliedTypeName,
  inlineFlow,
  inlineYamlValue,
  isExpressionType,
  isYamlValueProperty,
  keyedMapToList,
  longTypeName,
  qualifiesAsInlineValue,
  shortTypeName,
} from '@core/model/spelling';
import { BUILTIN_TYPES, type Descriptor, type Metamodel, type PropertyDef } from '@core/model/metamodel';
import { isElement, type Drawing, type Element, type State, type Study, type Value } from '@core/model/types';

type Warn = (message: string) => void;

/** The keys of a file's top level that are not root elements. */
export const RESERVED_DOC_KEYS = new Set(['id', 'definitions', 'elements', 'layout', 'diagram', 'state']);

export type YamlDoc = Record<string, unknown>;

const DOCUMENTATION = 'bpmn:Documentation';
const STUDY = 'studyflow:Study';

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

class Reader {
  readonly layout: Record<string, Drawing> = {};
  private readonly ids = new Map<string, Element>();
  private readonly references: { element: Element; key: string; many: boolean; context: string }[] = [];

  private readonly metamodel: Metamodel;
  private readonly warn: Warn;
  /** What the definitions declare, the namespaces of foreign elements among it. */
  private readonly namespaces: Record<string, unknown>;

  constructor(metamodel: Metamodel, warn: Warn, namespaces: Record<string, unknown>) {
    this.metamodel = metamodel;
    this.warn = warn;
    this.namespaces = namespaces;
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
    if (DI_NODE_TYPES.has(type)) expandDiNode(node);

    const element: Element = { type };
    this.inlineDrawing(node, own);
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
      const name = p.ns.localName;
      if (p.isReference) {
        element[name] = (p.isMany ? (Array.isArray(raw) ? raw : [raw]).map(String) : String(raw)) as Value;
        this.references.push({ element, key: name, many: !!p.isMany, context: type });
        continue;
      }
      if (p.isMany) {
        const list = Array.isArray(raw) ? raw as unknown[]
          : typeof raw === 'string' && p.type === DOCUMENTATION ? [raw]
          : keyedMapToList(raw);
        element[name] = list.map((item) => this.value(expandInlineFlow(item), p.type));
        continue;
      }
      if (isYamlValueProperty(p)) {
        element[name] = yamlValue(raw);
        continue;
      }
      element[name] = this.value(raw, p.type);
    }
    if (typeof element.id === 'string' && element.id) {
      if (this.ids.has(element.id)) this.warn(`the id '${element.id}' names two elements; a reference to it reaches only the last`);
      this.ids.set(element.id, element);
    }
    return typed ? element : foldTyped(this.metamodel, element);
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

  /** An element as the file writes it: an expression of nothing but its text as the text, a list holder as its list. */
  private simplified(element: Element): Value {
    if (isExpressionType(element.type) && typeof element.body === 'string' && element.body !== ''
      && Object.keys(element).every((key) => key === 'type' || key === 'body')) return element.body;
    const list = elementList(this.metamodel, element.type);
    if (list && Object.keys(element).every((key) => key === 'type' || key === list.ns.localName)) {
      const items = element[list.ns.localName];
      if (Array.isArray(items) && items.length > 0) return items;
    }
    return element;
  }


  /** The drawing written on an element (`bounds`, `waypoint`, colours), moved to the layout. */
  private inlineDrawing(node: Record<string, unknown>, own: Descriptor): void {
    const id = typeof node.id === 'string' ? node.id : undefined;
    const diType = 'bounds' in node && !own.propertiesByName.bounds ? 'bpmndi:BPMNShape'
      : 'waypoint' in node && !own.propertiesByName.waypoint ? 'bpmndi:BPMNEdge' : undefined;
    if (!diType) return;
    const di = this.metamodel.descriptor(diType).propertiesByName;
    const drawing: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      if (key === 'id' || own.propertiesByName[key] || !di[key]) continue;
      drawing[key] = node[key];
      delete node[key];
    }
    if (id) this.drawn(id, diType, drawing);
  }

  /** `drawing`, as the file writes it, kept as `id`'s. */
  drawn(id: string, diType: string, drawing: Record<string, unknown>): void {
    this.layout[id] = canonicalDrawing(this.metamodel, diType, drawing);
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

  get elements(): ReadonlyMap<string, Element> {
    return this.ids;
  }
}

/** The one list a BPMN list holder holds (`extensionElements`'s `values`): a schema's element with one list is an entry. */
function elementList(metamodel: Metamodel, type: string): PropertyDef | undefined {
  if (!metamodel.has(type)) return undefined;
  const descriptor = metamodel.descriptor(type);
  if (descriptor.ns.prefix !== 'bpmn') return undefined;
  const content = descriptor.properties.filter((p) => !p.isAttr && !p.isReference && !p.isBody);
  return content.length === 1 && content[0].isMany ? content[0] : undefined;
}

/** A YAML-typed attribute as the file writes it: its mapping when the text is one and may carry no comment, else its text. */
function yamlValue(raw: unknown): Value {
  const text = isMapping(raw) && qualifiesAsInlineValue(raw) ? expandInline(raw) : raw;
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

/** A study from its file: the text, or a document already parsed (a schema template's elements). */
export function readStudy(source: string | YamlDoc, metamodel: Metamodel, warn: Warn = (message) => console.warn(`[studyflow read] ${message}`)): Study {
  const doc = (typeof source === 'string' ? yaml.load(source) : source) as YamlDoc;
  if (!isMapping(doc) || !('definitions' in doc)) throw new Error("Not a studyflow YAML document (missing 'definitions').");
  const definitions: Record<string, Value> = { ...(doc.definitions as Record<string, Value> ?? {}) };
  const reader = new Reader(metamodel, warn, definitions);
  const id = doc.id ?? definitions.id;
  delete definitions.id;
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
    for (const [elementId, drawing] of Object.entries(doc.layout)) {
      const diType = isMapping(drawing) && 'bounds' in drawing ? 'bpmndi:BPMNShape' : isMapping(drawing) && 'waypoint' in drawing ? 'bpmndi:BPMNEdge' : undefined;
      if (!reader.has(elementId) || !diType) {
        warn(`layout draws '${elementId}', which ${reader.has(elementId) ? 'it gives no bounds or waypoint' : 'no element is'}; left out`);
        continue;
      }
      reader.drawn(elementId, diType, drawing as Record<string, unknown>);
    }
  }
  const diagram = Array.isArray(doc.diagram) ? readDiagrams(doc.diagram, reader, metamodel) : undefined;
  reader.resolve();
  const study: Study = { ...(id === undefined ? {} : { id: String(id) }), definitions, roots, layout: reader.layout };
  if (diagram && diagram.length > 0) study.diagram = diagram;
  if (isMapping(doc.state)) study.state = doc.state as State;
  impliedFlowLists(study, metamodel);
  return study;
}

/** A diagram section: each plane element the layout can spell moves to it; the rest, and a diagram that says more than
 * which root it draws, stay. */
function readDiagrams(raws: unknown[], reader: Reader, metamodel: Metamodel): Value[] {
  const kept: Value[] = [];
  raws.forEach((raw, index) => {
    if (!isMapping(raw)) return;
    const diagram = { ...raw };
    const plane = isMapping(diagram.plane) ? { ...diagram.plane } : undefined;
    if (plane && index === 0) {
      const elements = Array.isArray(plane.planeElement) ? plane.planeElement : keyedMapToList(plane.planeElement);
      const counts = new Map<string, number>();
      for (const pe of elements) if (isMapping(pe) && typeof pe.bpmnElement === 'string') counts.set(pe.bpmnElement, (counts.get(pe.bpmnElement) ?? 0) + 1);
      const rest = elements.filter((pe) => {
        if (!isMapping(pe)) return true;
        const type = typeof pe.type === 'string' ? longTypeName(pe.type) : undefined;
        const target = pe.bpmnElement;
        if (!type || !DI_NODE_TYPES.has(type) || typeof target !== 'string' || counts.get(target) !== 1 || !reader.has(target)) return true;
        const { type: _type, id: _id, bpmnElement: _ref, ...drawing } = pe;
        if (Object.keys(drawing).some((key) => ['sourceElement', 'targetElement', 'choreographyActivityShape'].includes(key))) return true;
        reader.drawn(target, type, drawing);
        return false;
      });
      if (rest.length > 0) plane.planeElement = rest;
      else delete plane.planeElement;
      diagram.plane = plane;
    }
    kept.push(diagram as Value);
  });
  void metamodel;
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

class Writer {
  /** The ids of the elements written, in the order the file writes them: the layout map's order. */
  readonly order: string[] = [];

  private readonly metamodel: Metamodel;
  private readonly held: Set<string>;
  private readonly warn?: Warn;

  constructor(metamodel: Metamodel, held: Set<string>, warn?: Warn) {
    this.metamodel = metamodel;
    this.held = held;
    this.warn = warn;
  }

  element(element: Element, declared: string | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (typeof element.id === 'string') this.order.push(element.id);
    const host = hostOf(this.metamodel, element.type);
    const typed = host !== element.type;
    if (element.type !== declared) out.type = shortTypeName(element.type);
    const own = this.metamodel.has(host) ? this.metamodel.descriptor(host) : undefined;
    const wrapper = typed ? this.metamodel.descriptor(element.type) : undefined;
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
      if (!written.has(key) && value !== undefined && !(typed && wrapper?.propertiesByName[key])) out[key] = value;
    }
    if (out.type !== undefined && impliedTypeName(out, declared) === element.type) delete out.type;
    if (!('name' in out)) return out;
    const { type, name, ...rest } = out;
    return { ...(type === undefined ? {} : { type }), name, ...rest };
  }

  private property(out: Record<string, unknown>, element: Element, p: PropertyDef, key: string): void {
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
      if (p.type === DOCUMENTATION && value.every((item) => typeof item === 'string')) {
        out[key] = value.length === 1 ? value[0] : value;
        return;
      }
      const items = value.map((item) => (typeof item === 'string' && p.type === DOCUMENTATION ? { text: item } : this.value(item, p.type)));
      out[key] = keyedById(items) ?? items;
      return;
    }
    out[key] = this.value(value, p.type);
  }

  private value(value: Value, declared: string | undefined): unknown {
    if (Array.isArray(value)) {
      const list = declared && elementList(this.metamodel, declared);
      return list ? value.map((item) => this.value(item, list.type)) : value;
    }
    if (isElement(value)) return this.element(value, declared);
    return value;
  }
}

/** A list of elements with distinct ids as the file writes it: keyed by id, a flow that only joins two ends as an arrow. */
function keyedById(items: unknown[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (!isMapping(item)) return undefined;
    const { id, ...body } = item;
    if (typeof id !== 'string' || id === '' || id in out) return undefined;
    out[id] = inlineFlow(item) ?? body;
  }
  return out;
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
  if (!isMapping(node) || Object.keys(node).some((key) => key !== 'id' && key !== 'plane')) return false;
  const plane = node.plane;
  if (!isMapping(plane)) return true;
  if (Object.keys(plane).some((key) => key !== 'id' && key !== 'bpmnElement')) return false;
  const named = plane.bpmnElement;
  return named === undefined || named === inferredRoot(study, metamodel)?.id
    || study.roots.some((root) => root.id === named && isHeadlessCollaboration(root));
}

/** The study as its file's document: the structure `js-yaml` dumps to the text the tools write. */
export function writeStudy(study: Study, metamodel: Metamodel, warn?: Warn): YamlDoc {
  const writer = new Writer(metamodel, heldIds(study), warn);
  const doc: YamlDoc = {};
  if (study.id !== undefined) doc.id = study.id;
  const definitions: Record<string, unknown> = {};
  const own = metamodel.descriptor('bpmn:Definitions');
  for (const p of own.properties) {
    const key = p.ns.localName;
    const value = study.definitions[key];
    if (key === 'id' || value === undefined || value === null || (p.default !== undefined && value === p.default)) continue;
    definitions[key] = value;
  }
  for (const [key, value] of Object.entries(study.definitions)) {
    if (!(key in definitions) && !own.propertiesByName[key] && !redundantNamespace(metamodel, key, value)) definitions[key] = value;
  }
  doc.definitions = definitions;
  const unkeyable: unknown[] = [];
  const written = study.roots.map((root) => writer.element(root, 'bpmn:RootElement'));
  const keyed = keyedById(written);
  if (!keyed) unkeyable.push(...written);
  else {
    for (const [key, body] of Object.entries(keyed)) {
      if (!RESERVED_DOC_KEYS.has(key) && !(key in doc)) doc[key] = body;
      else unkeyable.push({ id: key, ...(body as object) });
    }
  }
  if (unkeyable.length > 0) doc.elements = unkeyable;
  // Each drawing in the order its element is written, so the layout reads as the elements do.
  const layout = Object.fromEntries(writer.order.filter((id) => study.layout[id]).map((id) => [id, study.layout[id]]));
  if (Object.keys(layout).length > 0) doc.layout = layout;
  const diagram = (study.diagram ?? []).filter((node, index, all) => !(index === 0 && all.length === 1 && redundantDiagram(node, study, metamodel)));
  if (diagram.length > 0) doc.diagram = diagram;
  if (study.state && Object.keys(study.state).length > 0) doc.state = study.state;
  return doc;
}

/** The study as the text of its `.studyflow.yaml` file. */
export function studyText(study: Study, metamodel: Metamodel, warn?: Warn): string {
  return yaml.dump(writeStudy(study, metamodel, warn), YAML_DUMP_OPTIONS);
}
