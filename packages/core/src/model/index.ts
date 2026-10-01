/**
 * A study model with its index: each element by id, the element that holds it and under which property, and what the
 * metamodel says of it (the BPMN element it is, the schema type that extends it, its properties).
 */
import { NON_EXTENSION_PREFIXES } from '@core/constants';
import type { Metamodel, PropertyDef } from '@core/model/metamodel';
import { expandInline } from '@core/model/spelling';
import { hostOf, inferredRoot, isHeadlessCollaboration, propertyOf } from '@core/model/yaml';
import { isElement, type Element, type Study, type Value } from '@core/model/types';

export type { Drawing, Element, State, Study, Value } from '@core/model/types';
export { isElement } from '@core/model/types';

/** Where an element sits: the element holding it (none for a root) and the property it is under. */
export type Holder = { parent?: Element; key: string };

export class StudyModel {
  readonly study: Study;
  readonly metamodel: Metamodel;
  private readonly byId = new Map<string, Element>();
  private readonly holders = new Map<Element, Holder>();

  constructor(study: Study, metamodel: Metamodel) {
    this.study = study;
    this.metamodel = metamodel;
    this.reindex();
  }

  /** Read the study's elements afresh, after an edit added, moved or removed some. */
  reindex(): void {
    this.byId.clear();
    this.holders.clear();
    const visit = (value: Value | undefined, holder: Holder): void => {
      if (Array.isArray(value)) value.forEach((item) => visit(item, holder));
      else if (isElement(value)) {
        this.holders.set(value, holder);
        if (typeof value.id === 'string' && value.id) this.byId.set(value.id, value);
        for (const [key, child] of Object.entries(value)) if (key !== 'type') visit(child, { parent: value, key });
      }
    };
    for (const root of this.study.roots) visit(root, { key: 'rootElements' });
  }

  get(id: string | undefined): Element | undefined {
    return id === undefined ? undefined : this.byId.get(id);
  }

  /** Every element with an id, in the order the file writes them. */
  elements(): IterableIterator<Element> {
    return this.byId.values();
  }

  /** Every element the study holds, ids or none, each before what it holds. */
  all(): IterableIterator<Element> {
    return this.holders.keys();
  }

  /** The id of `element`, else of the nearest element holding it that has one: whose an issue is. */
  ownerOf(element: Element): string | undefined {
    for (let at: Element | undefined = element; at; at = this.parentOf(at)) if (typeof at.id === 'string') return at.id;
    return undefined;
  }

  /** The property `key` of `element` where it sits: an extension entry is its own type; any other element its BPMN
   * element's, then its schema type's. */
  propertyAt(element: Element, key: string): PropertyDef | undefined {
    if (this.holders.get(element)?.key === 'extensionElements') return this.metamodel.has(element.type) ? this.metamodel.property(element.type, key) : undefined;
    return this.property(element, key);
  }

  holderOf(element: Element): Holder | undefined {
    return this.holders.get(element);
  }

  parentOf(element: Element): Element | undefined {
    return this.holders.get(element)?.parent;
  }

  /** The BPMN element `element` is: its type, or, for a schema's typed element, the one it attaches to. */
  host(element: Element): string {
    return hostOf(this.metamodel, element.type);
  }

  /** Whether `element` is a `type`: its BPMN element is one, or its schema type is. */
  isA(element: Element | undefined, type: string): boolean {
    if (!element) return false;
    const host = this.host(element);
    return this.metamodel.isA(host, type) || (host !== element.type && this.metamodel.isA(element.type, type));
  }

  /** The property `key` of `element`: its BPMN element's, else its schema type's. */
  property(element: Element, key: string): PropertyDef | undefined {
    return propertyOf(this.metamodel, element.type, key);
  }

  /** The schema type that extends `element`: its own type when a schema types it, else the first schema entry in its
   * `extensionElements` (a provenance record is no such entry). */
  extensionType(element: Element): string | undefined {
    if (this.host(element) !== element.type) return element.type;
    return this.entries(element).find((entry) => isExtensionPrefix(entry.type.split(':')[0]))?.type;
  }

  /** The schema type's attributes of a typed element, as the entry its BPMN XML writes: `{type, ...attributes}`. */
  typedEntry(element: Element): Element | undefined {
    const host = this.host(element);
    if (host === element.type) return undefined;
    const own = this.metamodel.descriptor(host).propertiesByName;
    const wrapper = this.metamodel.descriptor(element.type).propertiesByName;
    const entry: Element = { type: element.type };
    for (const [key, value] of Object.entries(element)) {
      if (key !== 'type' && wrapper[key] && !own[key]) entry[key] = value;
    }
    return entry;
  }

  /** What `element` holds under `name`: its own value, else its schema entry's (an entry its BPMN element keeps in
   * `extensionElements`, when no schema types it). */
  attribute(element: Element, name: string): Value | undefined {
    if (name in element) return element[name];
    const type = this.extensionType(element);
    return type && type !== element.type ? this.entries(element).find((entry) => entry.type === type)?.[name] : undefined;
  }

  /** What `element` holds under `name`, as {@link attribute} reads it, else the default its schema declares. */
  attributeOrDefault(element: Element, name: string): Value | undefined {
    const value = this.attribute(element, name);
    if (value !== undefined) return value;
    const type = this.extensionType(element);
    const declared = this.property(element, name) ?? (type ? this.metamodel.property(type, name) : undefined);
    return declared?.default as Value | undefined;
  }

  /** Set what `element` holds under `name` where {@link attribute} reads it: the element's own value when it holds one or
   * its type declares it, else its schema entry's. `undefined` removes it. */
  setAttribute(element: Element, name: string, value: Value | undefined): void {
    const type = this.extensionType(element);
    const entry = type && type !== element.type && !(name in element) && !this.property(element, name)
      ? this.entries(element).find((candidate) => candidate.type === type) : undefined;
    const holder = entry ?? element;
    if (value === undefined) delete holder[name];
    else holder[name] = value;
  }

  /** The entries of `element`'s `extensionElements`, as the file lists them. */
  entries(element: Element): Element[] {
    const list = element.extensionElements;
    return Array.isArray(list) ? list.filter(isElement) : [];
  }

  /** The `studyflow:Study` of the study: the root a schema types so, or the entry a root carries. */
  studyOf(root: Element | undefined): Element | undefined {
    if (!root) return undefined;
    return root.type === 'studyflow:Study' ? root : this.entries(root).find((entry) => entry.type === 'studyflow:Study');
  }

  /** The root the study is: the one its drawing names, unless that is a collaboration with no pool; else the one the
   * reader infers. */
  primaryRoot(): Element | undefined {
    const plane = this.study.diagram?.[0];
    const named = isMapping(plane) && isMapping(plane.plane) ? this.get(String(plane.plane.bpmnElement ?? '')) : undefined;
    if (named && !isHeadlessCollaboration(named)) return named;
    return inferredRoot(this.study, this.metamodel);
  }

  /** The runtime the study declares on its `studyflow:Study`, else `local`. */
  runtime(): string {
    const runtime = this.studyOf(this.primaryRoot())?.runtime;
    return typeof runtime === 'string' && runtime ? runtime : 'local';
  }
}

const isMapping = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function isExtensionPrefix(prefix: string | undefined): boolean {
  return !!prefix && !NON_EXTENSION_PREFIXES.has(prefix);
}

/** A YAML-typed value as its text: the text itself, or the mapping the model holds it as, dumped. */
export function yamlText(value: Value | undefined): string | undefined {
  if (typeof value === 'string') return value;
  return value && typeof value === 'object' && !Array.isArray(value) && !isElement(value) ? expandInline(value) : undefined;
}

/** An element's first documentation, as its text: undefined when it has none. */
export function documentationOf(element: Element | undefined): string | undefined {
  const documentation = element?.documentation;
  const first = Array.isArray(documentation) ? documentation[0] : documentation;
  const text = isElement(first) ? first.text : first;
  return typeof text === 'string' && text.trim() ? text.trim() : undefined;
}

/** A reference's id, whether a property holds an id or (in a long form) `{id}`. */
export function idOf(value: Value | undefined): string | null {
  if (typeof value === 'string') return value;
  return isElement(value) && typeof value.id === 'string' ? value.id : null;
}

/** An expression's text and language: a property holding its text, or an expression element. */
export function expressionOf(value: Value | undefined): { body: string; language: string | null } | undefined {
  if (typeof value === 'string') return value.trim() ? { body: value.trim(), language: null } : undefined;
  if (!isElement(value) || typeof value.body !== 'string' || !value.body.trim()) return undefined;
  return { body: value.body.trim(), language: typeof value.language === 'string' ? value.language : null };
}
