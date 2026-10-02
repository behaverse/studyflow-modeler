import * as yaml from 'js-yaml';

import { isModdleElement, type Moddle } from '@core/document/moddle';
import { primaryRoot } from '@core/document/format';
import { RESERVED_DOC_KEYS, type YamlDoc } from '@core/model/yaml';
import { MODDLE_BUILTIN_TYPES } from '@core/notation/moddlePackage';
import {
  elementListProperty,
  expandDocumentationEntry,
  expandExpressionBody,
  extractInlineDi,
  unfoldTypedElement,
  isDocumentationProperty,
  isDocumentationType,
  type DiType,
} from '@core/document/shorthand';
import { DI_NODE_TYPES, expandDiNode, expandInline, expandInlineFlow, impliedTypeName, isExpressionType, isYamlValueProperty, keyedMapToList, longTypeName, qualifiesAsInlineValue } from '@core/model/spelling';
import type { StateTree } from '@core/model/state';
import { writeState } from '@core/document/state';

type PendingRef = {
  element: any;
  property: string;
  ids: string[];
  isMany: boolean;
  context: string;
};

type InlineDi = {
  element: any;
  type: DiType;
  props: Record<string, unknown>;
};

class ModdleBuilder {
  private moddle: Moddle;
  private pending: PendingRef[] = [];
  private byId = new Map<string, any>();
  private inlineDi: InlineDi[] = [];
  private descriptors = new Map<string, any>();
  private onWarning?: (message: string) => void;
  /** What the definitions declare, the namespaces of foreign elements among it. */
  private namespaces: Record<string, unknown>;

  constructor(moddle: Moddle, namespaces: Record<string, unknown>, onWarning?: (message: string) => void) {
    this.moddle = moddle;
    this.namespaces = namespaces;
    this.onWarning = onWarning;
  }

  build(node: Record<string, any>, declaredType: string | undefined): any {
    // A schema's typed element, written as its own type: read as the BPMN element it attaches to, with its wrapper.
    // Only where a BPMN element is expected: an extension entry (`declaredType` Element) is the wrapper itself.
    if (typeof node.type === 'string' && node.type.includes(':') && declaredType?.startsWith('bpmn:')) {
      const unfolded = unfoldTypedElement(this.moddle, node, longTypeName(node.type));
      if (unfolded) return this.build(unfolded, declaredType);
    }
    const { type, ...props } = node;
    const spelled = (type as string | undefined) ?? impliedTypeName(props, declaredType) ?? declaredType;
    if (!spelled) throw new Error(`Element is missing a 'type': ${JSON.stringify(node).slice(0, 120)}`);
    const typeName = longTypeName(spelled);
    if (!this.moddle.getPackage(typeName.split(':')[0])) return this.foreign(typeName, props);
    if (DI_NODE_TYPES.has(typeName)) expandDiNode(props);

    const el = this.createElement(typeName);
    const descriptor = this.moddle.getElementDescriptor(el);
    this.extractInlineDi(el, descriptor, props);

    for (const [name, raw] of Object.entries(props)) {
      if (raw === undefined || raw === null) continue;
      const p = descriptor.propertiesByName?.[name];

      if (!p) {
        el.$attrs[name] = raw;
        // A key in a namespace no loaded schema owns is foreign by design. A bare key is likely a typo, and so is one a
        // loaded schema does not declare, which moddle's XML reader also flags when the modeler opens the file.
        if (!name.includes(':')) this.onWarning?.(`unknown key '${name}' on ${typeName} kept as a raw attribute (typo, or its schema is not loaded?)`);
        else if (this.moddle.getPackage(name.split(':')[0])) this.onWarning?.(`unknown attribute <${name}> on ${typeName}`);
        continue;
      }

      if (p.isReference) {
        const ids = (p.isMany && Array.isArray(raw) ? raw : [raw]).map(String);
        this.pending.push({ element: el, property: p.name, ids, isMany: !!p.isMany, context: typeName });
        continue;
      }

      if (p.isMany) {
        const list = Array.isArray(raw) ? (raw as unknown[])
          : typeof raw === 'string' && isDocumentationProperty(p) ? [raw]
          : keyedMapToList(raw);
        const items = list.map((item) => this.buildValue(expandInlineFlow(item), p.type));
        for (const item of items) if (isModdleElement(item)) item.$parent = el;
        el.set(p.name, items);
        continue;
      }

      if (isYamlValueProperty(p)
          && raw && typeof raw === 'object' && !Array.isArray(raw)
          && qualifiesAsInlineValue(raw as Record<string, unknown>)) {
        el.set(p.name, expandInline(raw as Record<string, unknown>));
        continue;
      }

      const value = this.buildValue(raw, p.type);
      if (isModdleElement(value)) value.$parent = el;
      el.set(p.name, value);
    }

    if (typeof el.id === 'string' && el.id) {
      if (this.byId.has(el.id)) this.onWarning?.(`the id '${el.id}' names two elements; a reference to it reaches only the last`);
      this.byId.set(el.id, el);
    }
    return el;
  }

  /** An element of a namespace no loaded schema declares, in the namespace `definitions:` declares for its prefix: its
   * attributes, and a child element for each of a list's texts. */
  private foreign(type: string, props: Record<string, unknown>): any {
    const [prefix] = type.split(':');
    const uri = this.namespaces[`xmlns:${prefix}`];
    if (typeof uri !== 'string') throw new Error(`unknown type <${type}>`);
    const el = this.moddle.createAny(type, uri, Object.fromEntries(Object.entries(props).filter(([, value]) => !Array.isArray(value))));
    el.$children = Object.entries(props).flatMap(([key, value]) => (Array.isArray(value)
      ? value.map((text) => this.moddle.createAny(`${prefix}:${key}`, uri, { $body: String(text) })) : []));
    return el;
  }

  /** The document's `layout:` map, each element's drawing by its id, read as the drawing written on the element is. */
  adoptLayout(layout: unknown): void {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return;
    for (const [id, drawing] of Object.entries(layout as Record<string, Record<string, unknown>>)) {
      const element = this.byId.get(id);
      const type = drawing && 'bounds' in drawing ? 'bpmndi:BPMNShape' : drawing && 'waypoint' in drawing ? 'bpmndi:BPMNEdge' : undefined;
      if (!element) {
        this.onWarning?.(`layout draws '${id}', which no element is; left out`);
        continue;
      }
      // The look of an element not drawn yet: BPMN's diagram interchange has no shape or edge without its geometry.
      if (!type) continue;
      this.inlineDi.push({ element, type, props: { ...drawing } });
    }
  }

  buildDiagrams(docDiagrams: unknown[]): any[] {
    const diagrams = docDiagrams.map((node) => this.build(node as Record<string, any>, 'bpmndi:BPMNDiagram'));
    if (this.inlineDi.length === 0) return diagrams;

    let diagram = diagrams[0];
    if (!diagram) {
      diagram = this.moddle.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_1' });
      diagrams.push(diagram);
    }
    let plane = diagram.plane;
    if (!plane) {
      plane = this.moddle.create('bpmndi:BPMNPlane', { id: 'BPMNPlane_1' });
      plane.$parent = diagram;
      diagram.set('plane', plane);
    }

    const planeElements = plane.get('planeElement');
    for (const { element, type, props } of this.inlineDi) {
      const id = typeof element.id === 'string' && element.id ? `${element.id}_di` : undefined;
      const pe = this.build({ type, ...(id ? { id } : {}), ...props }, undefined);
      pe.set('bpmnElement', element);
      pe.$parent = plane;
      planeElements.push(pe);
    }
    return diagrams;
  }

  private createElement(typeName: string): any {
    return this.moddle.create(typeName, {});
  }

  private descriptorOf(typeName: string): any | undefined {
    if (!this.descriptors.has(typeName)) {
      let descriptor: any;
      try {
        descriptor = this.moddle.getElementDescriptor(this.createElement(typeName));
      } catch {
        descriptor = undefined;
      }
      this.descriptors.set(typeName, descriptor);
    }
    return this.descriptors.get(typeName);
  }

  private elementListPropertyOf(typeName: string): any | undefined {
    return elementListProperty(this.descriptorOf(typeName));
  }

  private extractInlineDi(el: any, descriptor: any, props: Record<string, any>): void {
    const extracted = extractInlineDi(
      props,
      descriptor.propertiesByName ?? {},
      (type) => this.descriptorOf(type)?.propertiesByName ?? {},
    );
    if (extracted) this.inlineDi.push({ element: el, ...extracted });
  }

  private buildValue(raw: unknown, declaredType: string | undefined): unknown {
    const isElementType = !!declaredType && !MODDLE_BUILTIN_TYPES.has(declaredType);

    if (Array.isArray(raw)) {
      const listProp = isElementType ? this.elementListPropertyOf(declaredType) : undefined;
      return listProp ? this.build({ type: declaredType, [listProp.name]: raw }, declaredType) : raw;
    }

    if (raw && typeof raw === 'object') {
      const node = raw as Record<string, any>;
      if ('type' in node) return this.build(node, declaredType);
      if (!isElementType) return raw;
      return this.build(node, declaredType);
    }

    if (typeof raw === 'string' && isElementType) {
      if (isExpressionType(declaredType)) return this.build(expandExpressionBody(raw), declaredType);
      if (isDocumentationType(declaredType)) return this.build(expandDocumentationEntry(raw), declaredType);
    }

    return raw;
  }

  resolveReferences(): void {
    // A reference to an id the file does not hold is left out with a warning, as the writer leaves one out: the rest
    // of the file still reads.
    for (const { element, property, ids, isMany, context } of this.pending) {
      const targets = ids.flatMap((id) => {
        const target = this.byId.get(id);
        if (!target) this.onWarning?.(`${context}#${property} names '${id}', which no element is; left out`);
        return target ? [target] : [];
      });
      if (isMany) element.set(property, targets);
      else if (targets.length > 0) element.set(property, targets[0]);
    }
  }

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

/** `source` is the file's text, or a document already parsed (a schema template's elements, under `elements:`). */
export function studyflowToDefinitions(
  source: string | YamlDoc,
  moddle: Moddle,
  onWarning: (message: string) => void = (message) => console.warn(`[studyflow read] ${message}`),
): any {
  const doc = (typeof source === 'string' ? yaml.load(source) : source) as YamlDoc;
  if (!doc || typeof doc !== 'object' || !('definitions' in doc)) {
    throw new Error("Not a studyflow YAML document (missing 'definitions').");
  }

  const rootElements: unknown[] = [];
  for (const [key, body] of Object.entries(doc)) {
    if (RESERVED_DOC_KEYS.has(key)) continue;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      onWarning(`top-level key '${key}' is not an element and was ignored`);
      continue;
    }
    rootElements.push(...keyedMapToList({ [key]: body }));
  }
  if (Array.isArray(doc.elements)) rootElements.push(...doc.elements);
  else if (doc.elements) rootElements.push(...keyedMapToList(doc.elements));

  const definitionAttrs: Record<string, unknown> = { ...((doc.definitions as Record<string, unknown>) ?? {}) };

  const builder = new ModdleBuilder(moddle, definitionAttrs, onWarning);
  const definitions = builder.build(
    {
      type: 'bpmn:Definitions',
      ...definitionAttrs,
      ...(doc.id !== undefined ? { id: doc.id } : {}),
      rootElements,
    },
    'bpmn:Definitions',
  );
  // A file's top level holds BPMN root elements, and moddle drops anything else there as an "unrecognized element" when
  // the modeler opens the file. A parsed document is a template's elements, which the modeler places inside a process.
  if (typeof source === 'string') {
    for (const root of definitions.rootElements ?? []) {
      if (root.$instanceOf('bpmn:RootElement')) continue;
      onWarning(`unrecognized element <${root.$type}>${root.id ? ` '${root.id}'` : ''} at the top level, which holds only root elements such as a process or a collaboration`);
    }
  }
  builder.adoptLayout(doc.layout);
  const diagrams = builder.buildDiagrams((doc.diagram as unknown[]) ?? []);
  for (const diagram of diagrams) diagram.$parent = definitions;
  if (diagrams.length > 0) definitions.set('diagrams', diagrams);
  builder.resolveReferences();
  builder.linkSequenceFlows();
  // A plane the doc does not name draws the primary root, picked once the references are in: until a pool's
  // `processRef` resolves, its collaboration looks like one holding only actors, and the process would win.
  const plane = definitions.diagrams?.[0]?.plane;
  if (plane && !plane.bpmnElement) plane.set('bpmnElement', primaryRoot(definitions));
  if (doc.state && typeof doc.state === 'object' && !Array.isArray(doc.state)) {
    writeState(definitions, moddle, doc.state as StateTree);
  }
  return definitions;
}
