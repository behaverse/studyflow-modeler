import { Field } from '@headlessui/react';
import { useEffect, useState } from 'react';
import { StringInput } from './StringInput';
import { CodeEditor } from './CodeEditor';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';
import { ArrayInput } from './ArrayInput';
import { OptionalStringInput } from './OptionalStringInput';
import { SchemaEditor } from './SchemaEditor';
import { useModeler } from '../useModeler';
import { useInspectedElement } from './hooks/useInspectedElement';
import { getAttribute } from '@/lib/core/extensions';
import { splitQName } from '@/lib/core/utils/naming';
import { field as s } from '../styles';

const MarkdownStringInput = (inputProps: any) => <StringInput {...inputProps} isMarkdown />;

// `Enum` is a synthetic type produced by `resolveInputType` for enum-typed attributes.
const INPUT_BY_TYPE: Record<string, any> = {
  Boolean: BooleanInput,
  Enum: EnumInput,
  'studyflow:Schema': CodeEditor,
  'studyflow:MarkdownString': MarkdownStringInput,
  'studyflow:YAMLString': CodeEditor,
};

const PRIMITIVE_MODDLE_TYPES = new Set(['String', 'Integer', 'Real', 'Boolean', 'Number']);

/** Drill into a body-wrapper moddle type (e.g. `cognitive:Configurations`) and
 *  return the type of its `isBody` property — so wrappers around `YAMLString`
 *  render with the same editor as a direct `studyflow:YAMLString` attribute.
 *  Uses `registry.getEffectiveDescriptor` so inherited body properties (e.g. a
 *  subclass like `behaverse:BotConfigurations` that gets `value` from
 *  `cognitive:Configurations`) are visible. `getTypeDescriptor` alone returns
 *  only own properties and would miss them. */
function resolveBodyType(declaredType: string, modeler: any): string | undefined {
  if (!declaredType || PRIMITIVE_MODDLE_TYPES.has(declaredType)) return undefined;
  const moddle = modeler.get('moddle');
  let typeDef: any;
  try { typeDef = moddle.registry?.getEffectiveDescriptor?.(declaredType) ?? moddle.getTypeDescriptor?.(declaredType); }
  catch { return undefined; }
  if (!typeDef) return undefined;
  const props: any[] = Array.isArray(typeDef.properties)
    ? typeDef.properties
    : Object.values(typeDef.propertiesByName ?? {});
  return props.find((p: any) => p?.isBody)?.type;
}

function resolveInputType(declaredType: string, modeler: any): string {
  const { prefix, localName } = splitQName(declaredType);
  if (prefix && localName) {
    const pkg = modeler.get('moddle').getPackage(prefix);
    if (pkg?.enumerations?.some((e: any) => e.name === localName)) return 'Enum';
  }
  const bodyType = resolveBodyType(declaredType, modeler);
  if (bodyType && INPUT_BY_TYPE[bodyType]) return bodyType;
  return declaredType;
}

/** Whether an attribute definition renders in the inspector. */
export function isAttributeVisible(attrDef: any, element: any): boolean {
  if (!attrDef || !element) return true;
  if (attrDef.meta?.pinned) return false;
  if (!attrDef.meta?.condition) return true;

  const conditions = attrDef.meta.condition.body || {};
  return Object.entries(conditions).every(([key, expected]) => {
    const actual = getAttribute(element, key);
    if (expected === '$set') return actual != null;
    if (Array.isArray(expected)) return expected.includes(actual);
    return actual === expected;
  });
}

function pickInput(attrDef: any, modeler: any) {
  const declaredType = attrDef.type || 'String';
  const resolvedType = resolveInputType(declaredType, modeler);
  const isStringList = attrDef.isMany === true
    && (declaredType === 'String' || declaredType.endsWith(':MarkdownString'));
  const isOptionalString = attrDef.meta?.optional === true && declaredType === 'String';

  if (attrDef.meta?.editor === 'csvw-table') return SchemaEditor;
  if (isOptionalString) return OptionalStringInput;
  if (isStringList) return ArrayInput;
  return INPUT_BY_TYPE[resolvedType] ?? StringInput;
}

export function AttributeField({ attrDef }: { attrDef: any }) {
  const element = useInspectedElement();
  const modeler = useModeler();
  const eventBus = modeler.get('eventBus');

  const [isVisible, setVisible] = useState(() => isAttributeVisible(attrDef, element));

  useEffect(() => {
    setVisible(isAttributeVisible(attrDef, element));

    const onElementChanged = (e: any) => {
      if (e.element) setVisible(isAttributeVisible(attrDef, e.element));
    };
    eventBus.on('element.changed', onElementChanged);
    return () => eventBus.off('element.changed', onElementChanged);
  }, [attrDef, element, eventBus]);

  if (!isVisible) return null;

  const Input = pickInput(attrDef, modeler);
  return (
    <Field className={s.field}>
      <Input attrDef={attrDef} />
    </Field>
  );
}
