import * as yaml from 'js-yaml';

import { isModdleElement, type Moddle } from '@core/element/moddle';
import {
  RESERVED_DOC_KEYS,
  inferPlaneRoot,
  isPrimitiveTypeRef,
  type YamlDoc,
} from '@core/document/format';
import {
  CHECKLIST_MARKER,
  DI_NODE_TYPES,
  elementListProperty,
  expandChecklistEntry,
  expandDiNode,
  expandDocumentationEntry,
  expandExpressionBody,
  expandInlineBody,
  expandInlineFlow,
  expandInlineValue,
  extractInlineDi,
  impliedTypeName,
  isDocumentationProperty,
  isDocumentationType,
  isExpressionType,
  isYamlValueProperty,
  keyedMapToList,
  longTypeName,
  qualifiesAsInlineBody,
  qualifiesAsInlineValue,
  yamlBodyProperty,
  type DiType,
} from '@core/document/shorthand';

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

  constructor(moddle: Moddle, onWarning?: (message: string) => void) {
    this.moddle = moddle;
    this.onWarning = onWarning;
  }

  build(node: Record<string, any>, declaredType: string | undefined): any {
    const { type, ...props } = node;
    const spelled = (type as string | undefined) ?? impliedTypeName(props, declaredType) ?? declaredType;
    if (!spelled) throw new Error(`Element is missing a 'type': ${JSON.stringify(node).slice(0, 120)}`);
    const typeName = longTypeName(spelled);
    if (DI_NODE_TYPES.has(typeName)) expandDiNode(props);

    const el = this.createElement(typeName);
    const descriptor = this.moddle.getElementDescriptor(el);
    this.extractInlineDi(el, descriptor, props);

    let checklistText: string | undefined;
    for (const [name, raw] of Object.entries(props)) {
      if (raw === undefined || raw === null) continue;
      // Applied after the loop, so a `documentation` key in the same node cannot overwrite the checklist entry.
      if (name === CHECKLIST_MARKER && typeof raw === 'string'
          && descriptor.propertiesByName?.['documentation']) {
        checklistText = raw;
        continue;
      }
      const p = descriptor.propertiesByName?.[name];

      if (!p) {
        el.$attrs[name] = raw;
        // A namespaced key is a foreign attribute by design; only a bare one is likely a typo.
        if (!name.includes(':')) this.onWarning?.(`unknown key '${name}' on ${typeName} kept as a raw attribute (typo, or its schema is not loaded?)`);
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
        el.set(p.name, expandInlineValue(raw as Record<string, unknown>));
        continue;
      }

      const value = this.buildValue(raw, p.type);
      if (isModdleElement(value)) value.$parent = el;
      el.set(p.name, value);
    }

    if (checklistText !== undefined) {
      const entry = this.build(expandChecklistEntry(checklistText), undefined);
      entry.$parent = el;
      el.get('documentation').push(entry);
    }

    if (typeof el.id === 'string' && el.id) this.byId.set(el.id, el);
    return el;
  }

  buildDiagrams(docDiagrams: unknown[], definitions: any): any[] {
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
    // A doc-provided bpmnElement wins: `resolveReferences` runs later and overwrites this default.
    if (!plane.bpmnElement) plane.set('bpmnElement', inferPlaneRoot(definitions));

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

  private yamlBodyPropertyOf(typeName: string): any | undefined {
    return yamlBodyProperty(this.descriptorOf(typeName));
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
    const isElementType = !!declaredType && !isPrimitiveTypeRef(declaredType);

    if (Array.isArray(raw)) {
      const listProp = isElementType ? this.elementListPropertyOf(declaredType) : undefined;
      return listProp ? this.build({ type: declaredType, [listProp.name]: raw }, declaredType) : raw;
    }

    if (raw && typeof raw === 'object') {
      const node = raw as Record<string, any>;
      if ('type' in node) return this.build(node, declaredType);
      if (!isElementType) return raw;
      const body = this.yamlBodyPropertyOf(declaredType);
      if (body && qualifiesAsInlineBody(node, this.descriptorOf(declaredType))) {
        return this.build({ type: declaredType, [body.name]: expandInlineBody(node) }, declaredType);
      }
      return this.build(node, declaredType);
    }

    if (typeof raw === 'string' && isElementType) {
      const body = this.yamlBodyPropertyOf(declaredType);
      if (body) return this.build({ type: declaredType, [body.name]: raw }, declaredType);
      if (isExpressionType(declaredType)) return this.build(expandExpressionBody(raw), declaredType);
      if (isDocumentationType(declaredType)) return this.build(expandDocumentationEntry(raw), declaredType);
    }

    return raw;
  }

  resolveReferences(): void {
    for (const { element, property, ids, isMany, context } of this.pending) {
      const targets = ids.map((id) => {
        const target = this.byId.get(id);
        if (!target) throw new Error(`Unresolved reference '${id}' on ${context}#${property}`);
        return target;
      });
      element.set(property, isMany ? targets : targets[0]);
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

export function studyflowToDefinitions(
  yamlText: string,
  moddle: Moddle,
  onWarning: (message: string) => void = (message) => console.warn(`[studyflow read] ${message}`),
): any {
  const doc = yaml.load(yamlText) as YamlDoc;
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

  const builder = new ModdleBuilder(moddle, onWarning);
  const definitions = builder.build(
    {
      type: 'bpmn:Definitions',
      ...definitionAttrs,
      ...(doc.id !== undefined ? { id: doc.id } : {}),
      rootElements,
    },
    'bpmn:Definitions',
  );
  const diagrams = builder.buildDiagrams((doc.diagram as unknown[]) ?? [], definitions);
  for (const diagram of diagrams) diagram.$parent = definitions;
  if (diagrams.length > 0) definitions.set('diagrams', diagrams);
  builder.resolveReferences();
  builder.linkSequenceFlows();
  return definitions;
}
