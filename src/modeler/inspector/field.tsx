import { Field } from '@headlessui/react';
import { useEffect, useState, useContext, useCallback } from 'react';
import { StringInput } from './StringInput';
import { CodeEditor } from './CodeEditor';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';
import { ArrayInput } from './ArrayInput';
import { OptionalStringInput } from './OptionalStringInput';
import { InspectorContext, ModelerContext } from '../contexts';
import { getProperty } from '@/lib/core/extensions';
import { splitQName } from '@/lib/core/utils/naming';
import { field as s } from '../styles';

type FieldProps = { bpmnProperty: any };

const MarkdownStringInput = (p: any) => <StringInput {...p} isMarkdown />;

/**
 * Maps a resolved property type to the input component that renders it.
 * `Enum` is a synthetic type produced by {@link resolveInputType} when the
 * declared type names an enumeration in its package.
 */
const INPUT_BY_TYPE: Record<string, any> = {
  Boolean: BooleanInput,
  Enum: EnumInput,
  'studyflow:Schema': CodeEditor,
  'studyflow:MarkdownString': MarkdownStringInput,
  'studyflow:YAMLString': CodeEditor,
};

function resolveInputType(declaredType: string, modeler: any): string {
  const { prefix, localName } = splitQName(declaredType);
  if (prefix && localName) {
    const pkg = modeler.get('moddle').getPackage(prefix);
    if (pkg?.enumerations?.some((e: any) => e.name === localName)) {
      return 'Enum';
    }
  }
  return declaredType;
}

/**
 * Check if a property is visible based on its condition.
 * For studyflow properties, conditions are checked against the extension
 * element wrapper, not the business object.
 */
export function isPropertyVisible(bProp: any, el: any): boolean {
  if (!bProp || !el) return true;
  if (bProp.meta?.pinned) return false;
  if (!bProp.meta?.condition) return true;

  // TODO this is only valid when condition.language is json
  const conditions = bProp.meta?.condition?.body || {};
  const results = Object.entries(conditions).map(([cKey, cExpectedVal]) => {
    const cVal = getProperty(el, cKey);
    if (cExpectedVal === '$set') {
      return cVal != null;
    }
    if (Array.isArray(cExpectedVal)) {
      return cExpectedVal.includes(cVal);
    }
    return cVal === cExpectedVal;
  });
  return results.every((r) => r);
}

export function PropertyField({ bpmnProperty }: FieldProps) {
  const { element } = useContext(InspectorContext);
  const { modeler } = useContext(ModelerContext);
  const injector = modeler.get('injector');
  const eventBus = injector.get('eventBus');

  const declaredType = bpmnProperty.type || 'String';
  const [isVisible, setVisible] = useState(true);

  const checkConditionalVisibility = useCallback((bProp: any, el: any) => {
    setVisible(isPropertyVisible(bProp, el));
  }, []);

  // initial + on-element-change visibility
  useEffect(() => {
    checkConditionalVisibility(bpmnProperty, element);
  }, [bpmnProperty, element, checkConditionalVisibility]);

  useEffect(() => {
    function onElementsChanged(e: any) {
      const newElement = e.element;
      if (newElement) checkConditionalVisibility(bpmnProperty, newElement);
    }
    eventBus.on('element.changed', onElementsChanged);
    return () => {
      eventBus.off('element.changed', onElementsChanged);
    };
  }, [eventBus, bpmnProperty, element, checkConditionalVisibility]);

  if (!isVisible) return null;

  const resolvedType = resolveInputType(declaredType, modeler);
  const isStringList = bpmnProperty.isMany === true && (
    declaredType === 'String' || declaredType.endsWith(':MarkdownString')
  );
  const isOptionalString =
    bpmnProperty.meta?.optional === true && (resolvedType === 'String' || declaredType === 'String');
  const Input = isOptionalString
    ? OptionalStringInput
    : isStringList
      ? ArrayInput
      : (INPUT_BY_TYPE[resolvedType] ?? StringInput);

  return (
    <Field className={s.field}>
      <Input bpmnProperty={bpmnProperty} />
    </Field>
  );
}
