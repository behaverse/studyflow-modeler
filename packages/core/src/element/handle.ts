import { getCatalog, type AttributeSpec } from '@behaverse/studyflow-core/notation';
import { CHECKLIST_MARKER, DOCUMENTATION_TYPE, isChecklistEntry } from '@behaverse/studyflow-core/document/shorthand';
import { BPMN } from '@behaverse/studyflow-core/constants';
import { splitQName, toLocalName } from '@behaverse/studyflow-core/naming';
import { getProperty, setProperty, type ModdleElement, type Moddle } from '@behaverse/studyflow-core/element/moddle';
// From the leaf module, not the `@behaverse/studyflow-core/element` barrel — the barrel imports this file (cycle).
import {
  getAttributeSpec,
  getAttributeSpecs,
  isExtensionPrefix,
  toBusinessObject,
} from '@behaverse/studyflow-core/element/attributes';

/**
 * Applies attribute updates to `target`, a moddle object owned by `element`
 * (the bpmn-js canvas element when the handle wraps one, else the business
 * object itself). The modeler's adapter records them as one undo step.
 */
export interface AttributeUpdater {
  update(element: any, target: ModdleElement, props: Record<string, any>): void;
}

const directUpdater: AttributeUpdater = {
  update(_element, target, props) {
    for (const [name, value] of Object.entries(props)) setProperty(target, name, value);
  },
};

function findExtension(bo: ModdleElement | null | undefined): ModdleElement | null {
  const values = bo?.extensionElements?.values;
  if (!values) return null;
  return values.find((ext: ModdleElement) => isExtensionPrefix(splitQName(ext.$type).prefix)) ?? null;
}

type AttributeTarget = {
  bo: ModdleElement;
  ext: ModdleElement | null;
  attributeName: string | undefined;
  target: ModdleElement | null;
};

function resolveName(name: string | undefined, attrDef: AttributeSpec | undefined): string | undefined {
  if (name === 'bpmn:id') return 'id';
  if (name === 'bpmn:name') return 'name';
  return attrDef?.name ?? attrDef?.ns?.localName ?? toLocalName(name);
}

/**
 * Which target (BO vs extension wrapper) and property name a read/write of `attributeName`
 * addresses. Precedence, first match wins: wrapper redefine → BO; BO-declared → BO;
 * wrapper-declared → wrapper; undeclared → wrapper if one exists sans traits, else BO.
 * Reads may still prefer an *explicitly stored* wrapper value over a BO default —
 * `extensionValueWins` has that rule, and `tests/element.unit.spec.ts` pins it.
 */
function resolveAttribute(
  bo: ModdleElement,
  ext: ModdleElement | null,
  attributeName: string,
  hasTraits: boolean,
): AttributeTarget {
  const boDef = getAttributeSpec(bo, attributeName);
  const extDef = getAttributeSpec(ext, attributeName);

  if (extDef && ext) {
    const redefined = extDef.redefinedName;
    if (redefined && (boDef || hasTraits)) {
      return { bo, ext, attributeName: redefined, target: bo };
    }
  }

  if (boDef) {
    return { bo, ext, attributeName: resolveName(attributeName, boDef), target: bo };
  }

  if (extDef && ext) {
    return { bo, ext, attributeName: resolveName(attributeName, extDef), target: ext };
  }

  const useExt = !!ext && !hasTraits;
  return {
    bo,
    ext,
    attributeName: resolveName(attributeName, undefined),
    target: useExt ? ext : bo,
  };
}

/** Whether the `bpmn:extensionElements` wrapper, not the business object, holds the value a read should return. */
export function extensionValueWins(
  extDef: AttributeSpec | undefined,
  ext: ModdleElement | null,
  extName: string,
  bo: ModdleElement,
  boName: string,
): boolean {
  if (!extDef) return false;

  const extValue = getProperty(ext, extName);
  const extHasValue = extValue !== undefined && !(Array.isArray(extValue) && extValue.length === 0);
  if (!extHasValue) return false;

  return extDef.meta?.pinned === true
    || hasStoredValue(ext, extName)
    || !hasStoredValue(bo, boName);
}

/** Explicitly stored, vs a default moddle materialized on the prototype — `hasOwnProperty` is the only way to tell them apart. */
function hasStoredValue(target: ModdleElement | null | undefined, name: string): boolean {
  if (!target || typeof target !== 'object') return false;
  const property = target.$model?.getPropertyDescriptor?.(target, name);
  if (property) return Object.prototype.hasOwnProperty.call(target, property.name);
  if (target.$attrs && name in target.$attrs) return true;
  return Object.prototype.hasOwnProperty.call(target, name);
}

function documentationEntries(list: unknown): { checklist: ModdleElement[]; prose: any[] } {
  const entries = Array.isArray(list) ? list : [];
  return {
    checklist: entries.filter((item) => isChecklistEntry(item)),
    prose: entries.filter((item) => !isChecklistEntry(item)),
  };
}

function warnDroppedWrite(attributeName: string, bo: ModdleElement): void {
  console.warn(`StudyflowElement.setAttribute('${attributeName}') resolved no target on ${bo?.$type ?? 'unknown element'}; the write was dropped.`);
}

function unwrapBodyValue(rawValue: any, attrDef: AttributeSpec | undefined): any {
  if (!attrDef?.bodyProp) return rawValue;
  if (Array.isArray(rawValue) && attrDef.isMany) {
    const prose = rawValue.filter((item) => !isChecklistEntry(item));
    const bodies = prose.map((item) =>
      item && typeof item === 'object' && item.$type ? getProperty(item, attrDef.bodyProp!) : undefined);
    if (bodies.some((body) => typeof body !== 'string')) return rawValue;
    return bodies.length === 0 ? undefined : bodies.join('\n\n');
  }
  if (!rawValue || typeof rawValue !== 'object' || !rawValue.$type) return rawValue;
  const inner = getProperty(rawValue, attrDef.bodyProp);
  return inner ?? '';
}

export class StudyflowElement {
  private readonly element: any;
  readonly businessObject: ModdleElement;
  private readonly updater: AttributeUpdater;

  private constructor(element: any, businessObject: ModdleElement, updater: AttributeUpdater) {
    this.element = element;
    this.businessObject = businessObject;
    this.updater = updater;
  }

  static fromElement(element: any, updater?: AttributeUpdater): StudyflowElement {
    const bo = toBusinessObject(element);
    return new StudyflowElement(element, bo, updater ?? directUpdater);
  }

  static fromBusinessObject(businessObjectOrElement: any): StudyflowElement {
    const bo = toBusinessObject(businessObjectOrElement);
    return new StudyflowElement(bo, bo, directUpdater);
  }

  get extension(): ModdleElement | null {
    return findExtension(this.businessObject);
  }

  get extensionType(): string | undefined {
    return this.extension?.$type;
  }

  get hasTraits(): boolean {
    return this.attributes().some((spec) => isExtensionPrefix(spec.ns?.prefix) || !!spec.redefines);
  }

  extensionAttributes(): AttributeSpec[] {
    const ext = this.extension;
    return ext ? getAttributeSpecs(ext) : [];
  }

  ensureExtension(
    extensionType: string,
    moddle: Moddle,
    defaults: Record<string, any> = {},
  ): ModdleElement | null {
    const entry = getCatalog().getType(extensionType);

    if (entry?.style === 'trait') {
      for (const [name, value] of Object.entries(defaults)) this.setAttribute(name, value);
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

    for (const [name, value] of Object.entries(defaults)) this.setAttribute(name, value);
    return wrapper;
  }

  attributes(): AttributeSpec[] {
    return getAttributeSpecs(this.businessObject);
  }

  attribute(name: string | undefined): AttributeSpec | undefined {
    return getAttributeSpec(this.businessObject, name);
  }

  getAttribute(attributeName: string): any {
    if (toLocalName(attributeName) === CHECKLIST_MARKER) return this.getChecklist();
    const bo = this.businessObject;
    const ext = findExtension(bo);
    const r = resolveAttribute(bo, ext, attributeName, this.hasTraits);
    if (!r.target || !r.attributeName) return undefined;

    if (r.ext && r.target === r.bo) {
      const extDef = getAttributeSpec(r.ext, attributeName);
      const extName = resolveName(attributeName, extDef) ?? r.attributeName;
      if (extensionValueWins(extDef, r.ext, extName, r.bo, r.attributeName)) {
        return unwrapBodyValue(getProperty(r.ext, extName), extDef);
      }
    }

    const value = getProperty(r.target, r.attributeName);
    const attrDef = getAttributeSpec(r.target, r.attributeName);
    return unwrapBodyValue(value, attrDef);
  }

  private expressionElement(attributeName: string): ModdleElement | undefined {
    const bo = this.businessObject;
    const ext = findExtension(bo);
    const r = resolveAttribute(bo, ext, attributeName, this.hasTraits);
    if (r.target && r.attributeName) {
      const value = getProperty(r.target, r.attributeName);
      if (value && typeof value === 'object' && value.$type) return value;
    }
    // The standard-loop condition lives one hop down on `loopCharacteristics` — the one expression generic resolution does not reach.
    const loop = bo?.loopCharacteristics;
    const localName = toLocalName(attributeName);
    if (loop && localName
      && (getAttributeSpec(loop, attributeName) ?? getAttributeSpec(loop, localName))) {
      const nested = getProperty(loop, localName);
      if (nested && typeof nested === 'object' && nested.$type) return nested;
    }
    return undefined;
  }

  getExpressionLanguage(attributeName: string): string | undefined {
    const language = this.expressionElement(attributeName)?.get?.('language');
    return typeof language === 'string' && language ? language : undefined;
  }

  setExpressionLanguage(attributeName: string, language: string | undefined): void {
    const expression = this.expressionElement(attributeName);
    if (!expression) return;
    this.updater.update(this.element ?? expression, expression, { language: language || undefined });
  }

  setAttribute(attributeName: string, value: any): void {
    if (toLocalName(attributeName) === CHECKLIST_MARKER) return this.setChecklist(value);
    const bo = this.businessObject;
    const ext = findExtension(bo);
    const r = resolveAttribute(bo, ext, attributeName, this.hasTraits);
    if (!r.target || !r.attributeName) return warnDroppedWrite(attributeName, bo);

    const attrDef = getAttributeSpec(r.target, r.attributeName);
    const bodyProp = attrDef?.bodyProp;

    if (bodyProp && (typeof value === 'string' || value == null)) {
      if (attrDef?.isMany) {
        const { checklist: kept, prose } = documentationEntries(getProperty(r.target, r.attributeName));
        if (value == null || value === '') {
          this.updater.update(this.element, r.target, { [r.attributeName]: kept.length > 0 ? kept : undefined });
          return;
        }
        if (prose.length === 1 && typeof prose[0] === 'object' && prose[0].$type) {
          this.updater.update(this.element, prose[0], { [bodyProp]: value });
          return;
        }
        const model = r.target?.$model ?? bo?.$model;
        if (model && attrDef?.type) {
          const child = model.create(attrDef.type, { [bodyProp]: value });
          child.$parent = r.target;
          this.updater.update(this.element, r.target, { [r.attributeName]: [child, ...kept] });
          return;
        }
      }
      if (value == null || value.trim() === '') {
        this.updater.update(this.element, r.target, { [r.attributeName]: undefined });
        return;
      }
      const existing = getProperty(r.target, r.attributeName);
      if (existing && typeof existing === 'object' && existing.$type) {
        this.updater.update(this.element, existing, { [bodyProp]: value });
        return;
      }
      // A bare string under a wrapper property does not serialize; moddle needs the declared element, and `bpmn:Expression` is abstract.
      const model = r.target?.$model ?? bo?.$model;
      if (model && attrDef?.type) {
        const wrapType = attrDef.type === 'bpmn:Expression' ? 'bpmn:FormalExpression' : attrDef.type;
        const wrapped = model.create(wrapType, { [bodyProp]: value ?? '' });
        wrapped.$parent = r.target;
        value = wrapped;
      }
    }

    this.updater.update(this.element, r.target, { [r.attributeName]: value });
  }

  private getChecklist(): any {
    const { checklist } = documentationEntries(getProperty(this.businessObject, 'documentation'));
    return checklist.length > 0 ? getProperty(checklist[0], 'text') ?? '' : undefined;
  }

  private setChecklist(value: any): void {
    const bo = this.businessObject;
    const { checklist, prose } = documentationEntries(getProperty(bo, 'documentation'));
    const entry = checklist[0];
    const text = typeof value === 'string' ? value : '';
    if (!text.trim()) {
      if (entry) {
        this.updater.update(this.element, bo, { ['documentation']: prose.length > 0 ? prose : undefined });
      }
      return;
    }
    if (entry) {
      this.updater.update(this.element, entry, { text });
      return;
    }
    const model = bo?.$model;
    if (!model) return;
    const created = model.create(DOCUMENTATION_TYPE, { [CHECKLIST_MARKER]: true, text });
    created.$parent = bo;
    this.updater.update(this.element, bo, { ['documentation']: [...prose, created] });
  }
}
