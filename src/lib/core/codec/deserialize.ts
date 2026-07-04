import * as yaml from 'js-yaml';

import { LEGACY_STUDYFLOW_NS, STUDYFLOW_NS } from '../constants';
import {
  RESERVED_DOC_KEYS,
  inferPlaneRoot,
  isModdleElement,
  isPrimitiveTypeRef,
  type YamlDoc,
} from './common';
import { elementListProperty } from './foldings/element-list';
import { keyedMapToList } from './foldings/id-keyed';
import { extractInlineDi, type DiType } from './foldings/inline-di';
import {
  foldInlineBody,
  foldInlineValue,
  isYamlValueProperty,
  qualifiesAsInlineBody,
  qualifiesAsInlineValue,
  yamlBodyProperty,
} from './foldings/yaml-body';

/**
 * The read direction of the codec: a parsed `.studyflow` YAML document builds
 * back into a moddle `bpmn:Definitions` tree, reversing the foldings
 * documented in `index.ts` and re-deriving what hand-written files may omit
 * (`incoming`/`outgoing`, DI ids, the primary plane).
 */

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
  private moddle: any;
  private pending: PendingRef[] = [];
  private byId = new Map<string, any>();
  private inlineDi: InlineDi[] = [];
  private descriptors = new Map<string, any>();

  constructor(moddle: any) {
    this.moddle = moddle;
  }

  build(node: Record<string, any>, declaredType: string | undefined): any {
    const { type, ...props } = node;
    const typeName = (type as string | undefined) ?? declaredType;
    if (!typeName) throw new Error(`Element is missing a 'type': ${JSON.stringify(node).slice(0, 120)}`);

    const el = this.createElement(typeName);
    const descriptor = this.moddle.getElementDescriptor(el);
    this.extractInlineDi(el, descriptor, props);

    for (const [name, raw] of Object.entries(props)) {
      if (raw === undefined || raw === null) continue;
      const p = descriptor.propertiesByName?.[name];

      if (!p) {
        // Unknown to the loaded schemas: keep as a raw XML attribute.
        el.$attrs[name] = raw;
        continue;
      }

      if (p.isReference) {
        const ids = (p.isMany ? (raw as unknown[]) : [raw]).map(String);
        this.pending.push({ element: el, property: p.name, ids, isMany: !!p.isMany, context: typeName });
        continue;
      }

      if (p.isMany) {
        const list = Array.isArray(raw) ? (raw as unknown[]) : keyedMapToList(raw);
        const items = list.map((item) => this.buildValue(item, p.type));
        for (const item of items) if (isModdleElement(item)) item.$parent = el;
        el.set(p.name, items);
        continue;
      }

      // Inlined YAML value: dump the mapping back into the property's string
      // form (the reverse of `inlineYamlValue`).
      if (isYamlValueProperty(p)
          && raw && typeof raw === 'object' && !Array.isArray(raw)
          && qualifiesAsInlineValue(raw as Record<string, unknown>)) {
        el.set(p.name, foldInlineValue(raw as Record<string, unknown>));
        continue;
      }

      const value = this.buildValue(raw, p.type);
      if (isModdleElement(value)) value.$parent = el;
      el.set(p.name, value);
    }

    if (typeof el.id === 'string' && el.id) this.byId.set(el.id, el);
    return el;
  }

  /**
   * Rebuild the bpmndi tree: leftover `diagram:` entries first, then the
   * geometry folded into elements (attached to the primary plane, which is
   * synthesized when the document carries none).
   */
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
    // A doc-provided bpmnElement reference wins — it overwrites this default
    // in resolveReferences.
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

  /** Renamed schema prefixes accepted in older `.studyflow` YAML files. */
  private static LEGACY_PREFIXES: Record<string, string> = { core: 'studyflow' };

  private createElement(typeName: string): any {
    try {
      return this.moddle.create(typeName, {});
    } catch (error) {
      const [prefix, localPart] = typeName.includes(':') ? typeName.split(':', 2) : [undefined, typeName];
      const renamed = prefix && ModdleBuilder.LEGACY_PREFIXES[prefix];
      if (!renamed) throw error;
      return this.moddle.create(`${renamed}:${localPart}`, {});
    }
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

  /** The single isMany content property of list-wrapper types (`bpmn:ExtensionElements#values`). */
  private elementListPropertyOf(typeName: string): any | undefined {
    return elementListProperty(this.descriptorOf(typeName));
  }

  /** The YAML-typed body property of config-wrapper types (`cognitive:Configurations#value`). */
  private yamlBodyPropertyOf(typeName: string): any | undefined {
    return yamlBodyProperty(this.descriptorOf(typeName));
  }

  /**
   * Pull inline diagram geometry off a semantic element node (the reverse of the
   * inline-DI folding), and stash it for `buildDiagrams` to attach to the plane.
   */
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
      // `extensionElements: [ ... ]` — a list given for a list-wrapper type
      // collapses back into its only isMany property.
      const listProp = isElementType ? this.elementListPropertyOf(declaredType) : undefined;
      return listProp ? this.build({ type: declaredType, [listProp.name]: raw }, declaredType) : raw;
    }

    if (raw && typeof raw === 'object') {
      const node = raw as Record<string, any>;
      if ('type' in node) return this.build(node, declaredType);
      if (!isElementType) return raw;
      const body = this.yamlBodyPropertyOf(declaredType);
      if (body && qualifiesAsInlineBody(node, this.descriptorOf(declaredType))) {
        // Inlined config body: dump the mapping back into the wrapper's YAML string.
        return this.build({ type: declaredType, [body.name]: foldInlineBody(node) }, declaredType);
      }
      return this.build(node, declaredType);
    }

    if (typeof raw === 'string' && isElementType) {
      const body = this.yamlBodyPropertyOf(declaredType);
      if (body) return this.build({ type: declaredType, [body.name]: raw }, declaredType);
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

  /**
   * Hand-written files may omit `incoming`/`outgoing` on flow nodes; derive
   * them from each sequence flow's `sourceRef`/`targetRef` after resolution.
   */
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

/** Rebuild a `bpmn:Definitions` tree from `.studyflow` YAML text. */
export function studyflowToDefinitions(yamlText: string, moddle: any): any {
  const doc = yaml.load(yamlText) as YamlDoc;
  if (!doc || typeof doc !== 'object' || !('definitions' in doc || 'studyflow' in doc)) {
    throw new Error("Not a studyflow YAML document (missing 'definitions').");
  }

  // Root elements: id-keyed top-level entries, plus the legacy `elements:` list.
  const rootElements: unknown[] = [];
  for (const [key, body] of Object.entries(doc)) {
    if (RESERVED_DOC_KEYS.has(key)) continue;
    rootElements.push(...keyedMapToList({ [key]: body }));
  }
  if (Array.isArray(doc.elements)) rootElements.push(...doc.elements);
  else if (doc.elements) rootElements.push(...keyedMapToList(doc.elements));

  // Older files declare the unversioned core namespace; rewrite it so the
  // declaration matches the registered (versioned) package.
  const definitionAttrs: Record<string, unknown> = { ...((doc.definitions as Record<string, unknown>) ?? {}) };
  for (const [key, value] of Object.entries(definitionAttrs)) {
    if (key.startsWith('xmlns') && value === LEGACY_STUDYFLOW_NS) definitionAttrs[key] = STUDYFLOW_NS;
  }

  const builder = new ModdleBuilder(moddle);
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
