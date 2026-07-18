import { getCatalog, type AttributeSpec } from '@/core/catalog';
import { BPMN } from '@/core/constants';
import { splitQName } from '@/core/naming';
import {
  getAttributeDefinition,
  getAttributeDefinitions,
  isExtensionPrefix,
  toBusinessObject,
} from '@/core/extensions';

/**
 * `StudyflowElement` — a catalog-aware handle to one element and its attributes.
 *
 * It is the single abstraction spanning a business object and the schema data
 * attached to it, whether that data lives on an extension **wrapper** (a
 * `bpmn:extensionElements` child) or is mixed onto the business object as a
 * **trait**. Callers address attributes by name and reach the wrapper through
 * `.extension`, mirroring how BPMN nests extension data inside an element —
 * there is no separate "extension element" concept to track alongside it.
 *
 * Obtain one via {@link StudyflowElement.fromElement} (read + write, in the
 * modeler) or {@link StudyflowElement.fromBusinessObject} (read + direct write,
 * in the runner, exporters, and codec). The two differ only in the {@link Writer}
 * they carry.
 */

// ---------------------------------------------------------------------------
// Writers — the write-application strategy behind the interface
// ---------------------------------------------------------------------------

/** Applies a resolved write. Two adapters: {@link modelingWriter} (bpmn-js
 *  undo/redo) and {@link directWriter} (direct moddle mutation). */
export interface Writer {
  /** Write `value` under `name` on the resolved target. */
  apply(
    element: any,
    target: any,
    targetKind: 'business-object' | 'extension-element',
    name: string,
    value: any,
  ): void;
  /** Write a bag of properties onto a nested moddle object (a body wrapper). */
  applyModdle(element: any, moddleObject: any, props: Record<string, any>): void;
}

function rawSet(target: any, name: string, value: any): void {
  if (typeof target?.set === 'function') target.set(name, value);
  else if (target) target[name] = value;
}

/** Direct moddle mutation — no bpmn-js. Used by the runner, codec, creation-time
 *  default stamping, and unit tests. */
export const directWriter: Writer = {
  apply(_element, target, _targetKind, name, value) {
    rawSet(target, name, value);
  },
  applyModdle(_element, moddleObject, props) {
    for (const [name, value] of Object.entries(props)) rawSet(moddleObject, name, value);
  },
};

/** bpmn-js `modeling`-backed writer: records undo/redo on live elements. */
export function modelingWriter(modeling: any): Writer {
  return {
    apply(element, target, targetKind, name, value) {
      if (targetKind === 'business-object') modeling.updateProperties(element, { [name]: value });
      else modeling.updateModdleProperties(element, target, { [name]: value });
    },
    applyModdle(element, moddleObject, props) {
      modeling.updateModdleProperties(element, moddleObject, props);
    },
  };
}

// ---------------------------------------------------------------------------
// Extension wrapper + resolution (pure over the moddle tree)
// ---------------------------------------------------------------------------

/** First non-core extension wrapper on a business object's `extensionElements`. */
function findExtension(bo: any): any {
  const values = bo?.extensionElements?.values;
  if (!values) return null;
  return values.find((ext: any) => isExtensionPrefix(splitQName(ext.$type).prefix)) ?? null;
}

type Resolved = {
  bo: any;
  ext: any;
  attributeName: string | undefined;
  target: any;
  targetKind: 'business-object' | 'extension-element';
};

function resolveName(name: string | undefined, attrDef: AttributeSpec | undefined): string | undefined {
  if (name === 'bpmn:id') return 'id';
  if (name === 'bpmn:name') return 'name';
  return attrDef?.name ?? attrDef?.ns?.localName ?? toLocalName(name);
}

function toLocalName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

/** Decide which target (business object vs extension wrapper) and property name
 *  a read/write of `attributeName` addresses. Pure over the moddle tree. */
function resolveAttribute(bo: any, ext: any, attributeName: string, hasTraits: boolean): Resolved {
  const boDef = getAttributeDefinition(bo, attributeName);
  const extDef = getAttributeDefinition(ext, attributeName);

  // Extension redefines a BO attribute -> write under the redefined name.
  if (extDef && ext) {
    const redefined = extDef.redefinedName;
    if (redefined && (boDef || hasTraits)) {
      return { bo, ext, attributeName: redefined, target: bo, targetKind: 'business-object' };
    }
  }

  if (boDef) {
    return { bo, ext, attributeName: resolveName(attributeName, boDef), target: bo, targetKind: 'business-object' };
  }

  if (extDef && ext) {
    return { bo, ext, attributeName: resolveName(attributeName, extDef), target: ext, targetKind: 'extension-element' };
  }

  // Unknown attribute: pick a target that won't silently drop the write.
  const useExt = !!ext && !hasTraits;
  return {
    bo,
    ext,
    attributeName: resolveName(attributeName, undefined),
    target: useExt ? ext : bo,
    targetKind: useExt ? 'extension-element' : 'business-object',
  };
}

function readRaw(target: any, name: string): any {
  if (!target) return undefined;
  return typeof target.get === 'function' ? target.get(name) : target[name];
}

/** True when `name` holds an explicitly stored value on the moddle object.
 *  moddle materializes descriptor defaults on the type's prototype; parsed and
 *  written values become own properties, so own-ness tells the two apart. */
function hasStoredValue(target: any, name: string): boolean {
  if (!target || typeof target !== 'object') return false;
  const property = target.$model?.getPropertyDescriptor?.(target, name);
  if (property) return Object.prototype.hasOwnProperty.call(target, property.name);
  if (target.$attrs && name in target.$attrs) return true;
  return Object.prototype.hasOwnProperty.call(target, name);
}

/** Body-wrapped attribute (e.g. `cognitive:Configurations`, a BPMN
 *  expression element, or the `bpmn:documentation` list): unwrap the child
 *  element's value transparently. */
function unwrapBodyValue(rawValue: any, attrDef: AttributeSpec | undefined): any {
  if (!attrDef?.bodyProp) return rawValue;
  if (Array.isArray(rawValue) && attrDef.isMany) {
    // The `studyflow:checklist`-marked entry is the element's checklist, a
    // separate view - `documentation` reads the prose entries only.
    const prose = rawValue.filter((item) => !isChecklistEntry(item));
    const bodies = prose.map((item) =>
      item && typeof item === 'object' && item.$type ? readRaw(item, attrDef.bodyProp!) : undefined);
    if (bodies.some((body) => typeof body !== 'string')) return rawValue;
    return bodies.length === 0 ? undefined : bodies.join('\n\n');
  }
  if (!rawValue || typeof rawValue !== 'object' || !rawValue.$type) return rawValue;
  const inner = readRaw(rawValue, attrDef.bodyProp);
  return inner ?? '';
}

/** True for the `bpmn:documentation` entry carrying the element's checklist
 *  (the `studyflow:checklist="true"` marker; see `ChecklistDocumentation`). */
function isChecklistEntry(item: any): boolean {
  return !!item && typeof item === 'object' && !!item.$type && item.get?.('checklist') === true;
}

// ---------------------------------------------------------------------------
// The handle
// ---------------------------------------------------------------------------

export class StudyflowElement {
  /** The bpmn-js element when built from one, else the business object itself. */
  private readonly element: any;
  /** The business object — the single currency this handle reads and writes. */
  readonly businessObject: any;
  private readonly writer: Writer;

  private constructor(element: any, businessObject: any, writer: Writer) {
    this.element = element;
    this.businessObject = businessObject;
    this.writer = writer;
  }

  /** In the modeler: wrap a bpmn-js element. Pass `modeling` to write through
   *  bpmn-js (undo/redo); omit it for read-only or direct writes. */
  static fromElement(element: any, modeling?: any): StudyflowElement {
    const bo = toBusinessObject(element);
    return new StudyflowElement(element, bo, modeling ? modelingWriter(modeling) : directWriter);
  }

  /** In the runner, exporters, and codec: wrap a bare business object. Also
   *  accepts a bpmn-js element, which it unwraps, so it is the safe general
   *  entry point. Writes mutate the moddle tree directly. */
  static fromBusinessObject(businessObjectOrElement: any): StudyflowElement {
    const bo = toBusinessObject(businessObjectOrElement);
    return new StudyflowElement(bo, bo, directWriter);
  }

  // --- Extension wrapper (the schema data attached to this element) ----------

  /** The extension wrapper inside `bpmn:extensionElements`, or null. */
  get extension(): any {
    return findExtension(this.businessObject);
  }

  /** `$type` of the extension wrapper, e.g. `cognitive:CognitiveTask`. */
  get extensionType(): string | undefined {
    return this.extension?.$type;
  }

  /** True when schema-declared attributes are mixed onto the business object
   *  via traits - extension-namespaced ones, or redefines that keep BPMN's
   *  namespace (`bpmn:documentation`, `bpmn:conditionExpression`, ...). */
  get hasTraits(): boolean {
    return this.attributes().some((spec) => isExtensionPrefix(spec.ns?.prefix) || !!spec.redefines);
  }

  /** Attribute definitions declared on the extension wrapper, if any. */
  extensionAttributes(): AttributeSpec[] {
    const ext = this.extension;
    return ext ? getAttributeDefinitions(ext) : [];
  }

  /**
   * Ensure this element carries `extensionType`, creating the wrapper (and the
   * `bpmn:extensionElements` container) when needed and stamping `defaults`.
   * Trait types write their defaults straight onto the business object and
   * return null; wrapper types return the created wrapper.
   */
  ensureExtension(extensionType: string, moddle: any, defaults: Record<string, any> = {}): any {
    const entry = getCatalog().getType(extensionType);

    if (entry?.style === 'trait') {
      for (const [name, value] of Object.entries(defaults)) this.write(name, value);
      return null;
    }

    const bo = this.businessObject;
    if (!bo.extensionElements) {
      const container = moddle.create(BPMN.ExtensionElements, { values: [] });
      container.$parent = bo;
      bo.extensionElements = container;
    }

    const wrapper = moddle.create(extensionType, {});
    wrapper.$parent = bo.extensionElements;
    bo.extensionElements.values.push(wrapper);

    for (const [name, value] of Object.entries(defaults)) this.write(name, value);
    return wrapper;
  }

  // --- Attribute definitions -------------------------------------------------

  /** Every schema-defined attribute visible on this element (BPMN natives excluded). */
  attributes(): AttributeSpec[] {
    return getAttributeDefinitions(this.businessObject);
  }

  /** Definition for a single named attribute, including bpmn:id/bpmn:name. */
  attribute(name: string | undefined): AttributeSpec | undefined {
    return getAttributeDefinition(this.businessObject, name);
  }

  // --- Reads and writes ------------------------------------------------------

  /** Read an attribute by local or qualified name, resolving storage and
   *  unwrapping body-wrapped values. */
  read(attributeName: string): any {
    if (toLocalName(attributeName) === 'checklist') return this.readChecklist();
    const bo = this.businessObject;
    const ext = findExtension(bo);
    const r = resolveAttribute(bo, ext, attributeName, this.hasTraits);
    if (!r.target || !r.attributeName) return undefined;

    // Wrapper precedence: a pinned redefinition always wins; otherwise a
    // wrapper value wins only when it is explicitly stored, or when the BO has
    // none stored either (a redefined default beats an inherited trait
    // default). moddle materializes every descriptor default on the wrapper,
    // so an unconditional read here would mask values stored on the BO.
    if (r.ext && r.target === r.bo) {
      const extDef = getAttributeDefinition(r.ext, attributeName);
      if (extDef) {
        const extName = extDef.name ?? extDef.ns?.localName ?? r.attributeName;
        const extValue = readRaw(r.ext, extName);
        // moddle lazily initializes unset isMany properties to [] on read;
        // an empty list is "no value", not a stored one that could win.
        const extHasValue = extValue !== undefined && !(Array.isArray(extValue) && extValue.length === 0);
        const extWins =
          extDef.meta?.pinned === true ||
          hasStoredValue(r.ext, extName) ||
          !hasStoredValue(r.bo, r.attributeName);
        if (extHasValue && extWins) return unwrapBodyValue(extValue, extDef);
      }
    }

    const value = readRaw(r.target, r.attributeName);
    const attrDef = getAttributeDefinition(r.target, r.attributeName);
    return unwrapBodyValue(value, attrDef);
  }

  /** Write an attribute by name, resolving storage (business object, wrapper,
   *  or body-wrapped child) and applying via this handle's {@link Writer}. */
  write(attributeName: string, value: any): void {
    if (toLocalName(attributeName) === 'checklist') return this.writeChecklist(value);
    const bo = this.businessObject;
    const ext = findExtension(bo);
    const r = resolveAttribute(bo, ext, attributeName, this.hasTraits);
    if (!r.target || !r.attributeName) return;

    const attrDef = getAttributeDefinition(r.target, r.attributeName);
    const bodyProp = attrDef?.bodyProp;

    // Body-wrapped attribute: keep the wrapper instance and update its body.
    if (bodyProp && (typeof value === 'string' || value == null)) {
      // A body-carrying list (`bpmn:documentation`) folds as a list of one
      // prose entry: update it in place, clear on empty, else replace -
      // always preserving the checklist-marked entry alongside.
      if (attrDef?.isMany) {
        const existingList: any[] = Array.isArray(readRaw(r.target, r.attributeName))
          ? readRaw(r.target, r.attributeName)
          : [];
        const kept = existingList.filter((item) => isChecklistEntry(item));
        const prose = existingList.filter((item) => !isChecklistEntry(item));
        if (value == null || value === '') {
          this.writer.apply(this.element, r.target, r.targetKind, r.attributeName,
            kept.length > 0 ? kept : undefined);
          return;
        }
        if (prose.length === 1 && typeof prose[0] === 'object' && prose[0].$type) {
          this.writer.applyModdle(this.element, prose[0], { [bodyProp]: value });
          return;
        }
        const model = r.target?.$model ?? bo?.$model;
        if (model && attrDef?.type) {
          const child = model.create(attrDef.type, { [bodyProp]: value });
          child.$parent = r.target;
          this.writer.apply(this.element, r.target, r.targetKind, r.attributeName, [child, ...kept]);
          return;
        }
      }
      const existing = readRaw(r.target, r.attributeName);
      if (existing && typeof existing === 'object' && existing.$type) {
        this.writer.applyModdle(this.element, existing, { [bodyProp]: value ?? '' });
        return;
      }
      // Fresh wrapper of the declared type so writes survive serialization.
      // A declared `bpmn:Expression` gets a FormalExpression instance - the
      // concrete type BPMN serializes with `xsi:type`.
      const model = r.target?.$model ?? bo?.$model;
      if (model && attrDef?.type) {
        const wrapType = attrDef.type === 'bpmn:Expression' ? 'bpmn:FormalExpression' : attrDef.type;
        const wrapped = model.create(wrapType, { [bodyProp]: value ?? '' });
        wrapped.$parent = r.target;
        value = wrapped;
      }
    }

    this.writer.apply(this.element, r.target, r.targetKind, r.attributeName, value);
  }

  // --- The checklist view ----------------------------------------------------
  // An element's checklist is not stored as its own attribute: it is the
  // `studyflow:checklist="true"`-marked entry of the element's
  // `bpmn:documentation` list, so the text lives in BPMN's own container
  // (see `ChecklistDocumentation` in the studyflow schema).

  private readChecklist(): any {
    const bo = this.businessObject;
    const list = readRaw(bo, 'documentation');
    const entry = Array.isArray(list) ? list.find((item) => isChecklistEntry(item)) : undefined;
    if (entry) return readRaw(entry, 'text') ?? '';
    // Legacy files carried `studyflow:checklist` as a raw element attribute.
    const legacy = bo?.$attrs?.['studyflow:checklist'] ?? bo?.$attrs?.['checklist'];
    return typeof legacy === 'string' && legacy ? legacy : undefined;
  }

  private writeChecklist(value: any): void {
    const bo = this.businessObject;
    const list: any[] = Array.isArray(readRaw(bo, 'documentation')) ? readRaw(bo, 'documentation') : [];
    const entry = list.find((item) => isChecklistEntry(item));
    const text = typeof value === 'string' ? value : '';
    if (!text.trim()) {
      if (entry) {
        const remaining = list.filter((item) => item !== entry);
        this.writer.apply(this.element, bo, 'business-object', 'documentation',
          remaining.length > 0 ? remaining : undefined);
      }
      return;
    }
    if (entry) {
      this.writer.applyModdle(this.element, entry, { text });
      return;
    }
    const model = bo?.$model;
    if (!model) return;
    const created = model.create('bpmn:Documentation', { checklist: true, text });
    created.$parent = bo;
    this.writer.apply(this.element, bo, 'business-object', 'documentation', [...list, created]);
  }
}

/** Free-function aliases for the two entry points. */
export const fromElement = StudyflowElement.fromElement;
export const fromBusinessObject = StudyflowElement.fromBusinessObject;
