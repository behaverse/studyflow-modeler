import { getCatalog, type AttributeSpec } from '@core/notation';
import { CHECKLIST_MARKER, DOCUMENTATION_TYPE, isChecklistEntry } from '@core/document/shorthand';
import { BPMN } from '@core/constants';
import { splitQName, toLocalName } from '@core/naming';
import { getProperty, setProperty, type ModdleElement, type Moddle } from '@core/element/moddle';
// From the leaf module, not the `@core/element` barrel, which imports this file (cycle).
import {
  getAttributeSpec,
  getAttributeSpecs,
  isExtensionPrefix,
  toBusinessObject,
} from '@core/element/attributes';

/** Where a write goes: straight onto moddle by default; a study records it as an edit and redraws what shows it. */
export interface ModdleWriter {
  set(target: ModdleElement, props: Record<string, any>): void;
}

const directWriter: ModdleWriter = {
  set(target, props) {
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
 * Where an attribute lives (skills/SCHEMAS.md, "Attribute precedence"): on the element when its type (a trait
 * included) declares it; else on the wrapper, under the name it redefines when it redefines one of a wrapper it
 * extends; else on the element. A wrapper is no BPMN element and no trait reaches it, so the two never both hold one.
 */
function resolveAttribute(bo: ModdleElement, ext: ModdleElement | null, attributeName: string): AttributeTarget {
  const boDef = getAttributeSpec(bo, attributeName);
  if (boDef) return { bo, ext, attributeName: resolveName(attributeName, boDef), target: bo };
  const extDef = getAttributeSpec(ext, attributeName);
  if (ext && extDef) return { bo, ext, attributeName: extDef.redefinedName ?? resolveName(attributeName, extDef), target: ext };
  return { bo, ext, attributeName: resolveName(attributeName, undefined), target: bo };
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
  readonly businessObject: ModdleElement;
  private readonly writer: ModdleWriter;

  private constructor(businessObject: ModdleElement, writer: ModdleWriter) {
    this.businessObject = businessObject;
    this.writer = writer;
  }

  /** A handle on the business object of `elementOrBO`; writes go through `writer` (default: straight onto moddle). */
  static fromBusinessObject(elementOrBO: any, writer: ModdleWriter = directWriter): StudyflowElement {
    return new StudyflowElement(toBusinessObject(elementOrBO), writer);
  }

  get extension(): ModdleElement | null {
    return findExtension(this.businessObject);
  }

  get extensionType(): string | undefined {
    return this.extension?.$type;
  }

  extensionAttributes(): readonly AttributeSpec[] {
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

  attributes(): readonly AttributeSpec[] {
    return getAttributeSpecs(this.businessObject);
  }

  attribute(name: string | undefined): AttributeSpec | undefined {
    return getAttributeSpec(this.businessObject, name);
  }

  getAttribute(attributeName: string): any {
    if (toLocalName(attributeName) === CHECKLIST_MARKER) return this.getChecklist();
    const bo = this.businessObject;
    const ext = findExtension(bo);
    const r = resolveAttribute(bo, ext, attributeName);
    if (!r.target || !r.attributeName) return undefined;

    const value = getProperty(r.target, r.attributeName);
    const attrDef = getAttributeSpec(r.target, r.attributeName);
    return unwrapBodyValue(value, attrDef);
  }

  setAttribute(attributeName: string, value: any): void {
    if (toLocalName(attributeName) === CHECKLIST_MARKER) return this.setChecklist(value);
    const bo = this.businessObject;
    const ext = findExtension(bo);
    const r = resolveAttribute(bo, ext, attributeName);
    if (!r.target || !r.attributeName) return warnDroppedWrite(attributeName, bo);

    const attrDef = getAttributeSpec(r.target, r.attributeName);
    const bodyProp = attrDef?.bodyProp;

    if (bodyProp && (typeof value === 'string' || value == null)) {
      if (attrDef?.isMany) {
        const { checklist: kept, prose } = documentationEntries(getProperty(r.target, r.attributeName));
        if (value == null || value === '') {
          this.writer.set(r.target, { [r.attributeName]: kept.length > 0 ? kept : undefined });
          return;
        }
        if (prose.length === 1 && typeof prose[0] === 'object' && prose[0].$type) {
          this.writer.set(prose[0], { [bodyProp]: value });
          return;
        }
        const model = r.target?.$model ?? bo?.$model;
        if (model && attrDef?.type) {
          const child = model.create(attrDef.type, { [bodyProp]: value });
          child.$parent = r.target;
          this.writer.set(r.target, { [r.attributeName]: [child, ...kept] });
          return;
        }
      }
      if (value == null || value.trim() === '') {
        this.writer.set(r.target, { [r.attributeName]: undefined });
        return;
      }
      const existing = getProperty(r.target, r.attributeName);
      if (existing && typeof existing === 'object' && existing.$type) {
        this.writer.set(existing, { [bodyProp]: value });
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

    this.writer.set(r.target, { [r.attributeName]: value });
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
        this.writer.set(bo, { ['documentation']: prose.length > 0 ? prose : undefined });
      }
      return;
    }
    if (entry) {
      this.writer.set(entry, { text });
      return;
    }
    const model = bo?.$model;
    if (!model) return;
    const created = model.create(DOCUMENTATION_TYPE, { [CHECKLIST_MARKER]: true, text });
    created.$parent = bo;
    this.writer.set(bo, { ['documentation']: [...prose, created] });
  }
}
