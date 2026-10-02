/*
 * moddle's tree of a study as its file holds it (`writtenStudy`), what its BPMN XML is written from; `serialize.ts`
 * reads the tree back. Each element is created as its type (a mapping without one as the type its property declares),
 * a schema's typed element as the BPMN element it attaches to, with its schema's entry first among its extension
 * elements; a list holder from its list, an expression or documentation from its text, a YAML attribute's mapping as
 * its text; a reference as the element it names; the layout as diagram interchange.
 */
import { isModdleElement, type Moddle } from '@core/document/moddle';
import type { Metamodel } from '@core/model/metamodel';
import { BPMN_FORMAL_EXPRESSION, DI_NODE_TYPES, expandDiNode, expandInline, isExpressionType, isYamlValueProperty, qualifiesAsInlineValue } from '@core/model/spelling';
import type { Element, Study } from '@core/model/types';
import { attachOf, diagramElement, elementList, inferredRoot } from '@core/model/yaml';
import { MODDLE_BUILTIN_TYPES } from '@core/notation/moddlePackage';

const DOCUMENTATION = 'bpmn:Documentation';

type Mapping = Record<string, any>;

function isMapping(value: unknown): value is Mapping {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A schema's typed element as the BPMN element `host` it attaches to: the keys only its schema declares go to its
 * schema's entry, first among the element's extension elements. */
function unfolded(metamodel: Metamodel, element: Element, host: string): Element {
  const localKeys = (type: string) => new Set(metamodel.descriptor(type).properties.map((p) => p.ns.localName));
  const own = localKeys(host);
  const schema = localKeys(element.type);
  const entry: Element = { type: element.type };
  const out: Element = { type: host };
  for (const [key, value] of Object.entries(element)) {
    if (key === 'type') continue;
    if (schema.has(key) && !own.has(key)) entry[key] = value;
    else out[key] = value;
  }
  const list = out.extensionElements;
  out.extensionElements = Array.isArray(list) ? [entry, ...list]
    : isMapping(list) && Array.isArray(list.values) ? { ...list, values: [entry, ...list.values] }
    : [entry];
  return out;
}

class ModdleBuilder {
  private readonly pending: { element: any; property: string; ids: string[]; isMany: boolean }[] = [];
  private readonly byId = new Map<string, any>();
  private readonly moddle: Moddle;
  private readonly metamodel: Metamodel;
  /** What the definitions declare, the namespaces of foreign elements among it. */
  private readonly namespaces: Record<string, unknown>;

  constructor(moddle: Moddle, metamodel: Metamodel, namespaces: Record<string, unknown>) {
    this.moddle = moddle;
    this.metamodel = metamodel;
    this.namespaces = namespaces;
  }

  /** `node`, where an element of type `declared` is expected. */
  build(node: Mapping, declared: string | undefined): any {
    // Only where a BPMN element is expected: an extension entry is the schema's entry itself.
    const host = typeof node.type === 'string' && declared?.startsWith('bpmn:') ? attachOf(this.metamodel, node.type) : undefined;
    if (host) return this.build(unfolded(this.metamodel, node as Element, host), declared);
    const { type = declared, ...props } = node;
    if (!this.moddle.getPackage(type.split(':')[0])) return this.foreign(type, props);
    if (DI_NODE_TYPES.has(type)) expandDiNode(props);
    const el = this.moddle.create(type, {});
    const descriptor = this.moddle.getElementDescriptor(el);
    for (const [name, raw] of Object.entries(props)) {
      if (raw === undefined || raw === null) continue;
      const p = descriptor.propertiesByName?.[name];
      if (!p) el.$attrs[name] = raw;
      else if (p.isReference) {
        const ids = (p.isMany && Array.isArray(raw) ? raw : [raw]).map(String);
        this.pending.push({ element: el, property: p.name, ids, isMany: !!p.isMany });
      } else if (p.isMany) {
        // A list it cannot read (a route that is not one) is none.
        this.set(el, p.name, (Array.isArray(raw) ? raw : []).map((item) => this.value(item, p.type)));
      } else if (isYamlValueProperty(p) && isMapping(raw) && qualifiesAsInlineValue(raw)) {
        el.set(p.name, expandInline(raw));
      } else {
        this.set(el, p.name, this.value(raw, p.type));
      }
    }
    if (typeof el.id === 'string' && el.id) this.byId.set(el.id, el);
    return el;
  }

  /** An element of a namespace no loaded schema declares, in the namespace the definitions declare for its prefix: its
   * attributes, and a child element for each of a list's texts. */
  private foreign(type: string, props: Mapping): any {
    const [prefix] = type.split(':');
    const uri = this.namespaces[`xmlns:${prefix}`];
    if (typeof uri !== 'string') throw new Error(`unknown type <${type}>`);
    const el = this.moddle.createAny(type, uri, Object.fromEntries(Object.entries(props).filter(([, value]) => !Array.isArray(value))));
    el.$children = Object.entries(props).flatMap(([key, value]) => (Array.isArray(value)
      ? value.map((text) => this.moddle.createAny(`${prefix}:${key}`, uri, { $body: String(text) })) : []));
    return el;
  }

  /** What `raw` is where a `declared` value is expected: an element, a list holder of its list, an expression or
   * documentation of its text, or itself. */
  private value(raw: unknown, declared: string): unknown {
    const elementType = !MODDLE_BUILTIN_TYPES.has(declared);
    if (Array.isArray(raw)) {
      const list = elementType ? elementList(this.metamodel, declared) : undefined;
      return list ? this.build({ type: declared, [list.ns.localName]: raw }, declared) : raw;
    }
    if (isMapping(raw)) return 'type' in raw || elementType ? this.build(raw, declared) : raw;
    if (typeof raw === 'string' && isExpressionType(declared)) return this.build({ type: BPMN_FORMAL_EXPRESSION, body: raw }, declared);
    if (typeof raw === 'string' && declared === DOCUMENTATION) return this.build({ type: DOCUMENTATION, text: raw }, declared);
    return raw;
  }

  private set(el: any, name: string, value: unknown): void {
    for (const item of Array.isArray(value) ? value : [value]) if (isModdleElement(item)) item.$parent = el;
    el.set(name, value);
  }

  /** The study's diagrams, and its layout on the first one's plane (a diagram made when the study has none): a shape
   * or an edge for each drawing that has its geometry, since diagram interchange has none without. */
  diagrams(study: Study): any[] {
    // What each drawing draws, found before the diagrams' own ids are.
    const drawn = Object.entries(study.layout).flatMap(([id, drawing]) => {
      const type = 'bounds' in drawing ? 'bpmndi:BPMNShape' : 'waypoint' in drawing ? 'bpmndi:BPMNEdge' : undefined;
      const element = this.byId.get(id);
      return type && element ? [{ id, type, drawing, element }] : [];
    });
    const diagrams = (study.diagram ?? []).map((node) => this.build(diagramElement(node as Mapping, this.metamodel, this.namespaces), 'bpmndi:BPMNDiagram'));
    if (drawn.length === 0) return diagrams;
    let diagram = diagrams[0];
    if (!diagram) {
      diagram = this.moddle.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_1' });
      diagrams.push(diagram);
    }
    if (!diagram.plane) this.set(diagram, 'plane', this.moddle.create('bpmndi:BPMNPlane', { id: 'BPMNPlane_1' }));
    const planeElements = diagram.plane.get('planeElement');
    for (const { id, type, drawing, element } of drawn) {
      const shape = this.build({ type, id: `${id}_di`, ...drawing }, undefined);
      shape.set('bpmnElement', element);
      shape.$parent = diagram.plane;
      planeElements.push(shape);
    }
    return diagrams;
  }

  /** Each reference as the element it names; one naming no element (only a diagram can) is left out. */
  resolveReferences(): void {
    for (const { element, property, ids, isMany } of this.pending) {
      const targets = ids.flatMap((id) => (this.byId.has(id) ? [this.byId.get(id)] : []));
      if (isMany) element.set(property, targets);
      else if (targets.length > 0) element.set(property, targets[0]);
    }
  }

  /** Each node's `incoming` and `outgoing` lists, with the flows that name it: the study leaves out what they say. */
  linkSequenceFlows(): void {
    for (const el of this.byId.values()) {
      if (!el.$instanceOf?.('bpmn:SequenceFlow') || !el.sourceRef || !el.targetRef) continue;
      const outgoing = el.sourceRef.get?.('outgoing');
      if (Array.isArray(outgoing) && !outgoing.includes(el)) outgoing.push(el);
      const incoming = el.targetRef.get?.('incoming');
      if (Array.isArray(incoming) && !incoming.includes(el)) incoming.push(el);
    }
  }
}

/** moddle's definitions of `study`, a study as its file holds it (`writtenStudy`). */
export function studyToDefinitions(study: Study, metamodel: Metamodel, moddle: Moddle): any {
  const builder = new ModdleBuilder(moddle, metamodel, study.definitions);
  const id = study.id === undefined ? {} : { id: study.id };
  const definitions = builder.build({ type: 'bpmn:Definitions', ...study.definitions, ...id, rootElements: study.roots }, 'bpmn:Definitions');
  const diagrams = builder.diagrams(study);
  for (const diagram of diagrams) diagram.$parent = definitions;
  if (diagrams.length > 0) definitions.set('diagrams', diagrams);
  builder.resolveReferences();
  builder.linkSequenceFlows();
  // A plane that names no root draws the one the reader infers.
  const plane = definitions.diagrams?.[0]?.plane;
  const root = inferredRoot(study, metamodel);
  if (plane && !plane.bpmnElement && root) plane.set('bpmnElement', definitions.rootElements[study.roots.indexOf(root)]);
  return definitions;
}
