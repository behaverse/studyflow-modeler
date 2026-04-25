import { Field } from '@headlessui/react';
import { useEffect, useState, useContext, useCallback, type ComponentType } from 'react';
import { StringInput } from './StringInput';
import { SchemaEditor } from './SchemaEditor';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';
import { InspectorContext, ModelerContext } from '../contexts';
import { getProperty } from '../extensions';
import { splitQName } from '../utils/naming';

type FieldProps = { bpmnProperty: any };
type InputComp = ComponentType<{ bpmnProperty: any; isMarkdown?: boolean }>;

const MarkdownStringInput: InputComp = (p) => <StringInput {...p} isMarkdown />;

/**
 * Maps a resolved property type to the input component that renders it.
 * `Enum` is a synthetic type produced by {@link resolveInputType} when the
 * declared type names an enumeration in its package.
 */
const INPUT_BY_TYPE: Record<string, InputComp> = {
  Boolean: BooleanInput,
  Enum: EnumInput,
  'studyflow:Schema': SchemaEditor,
  'studyflow:MarkdownString': MarkdownStringInput,
  'studyflow:YAMLString': MarkdownStringInput,
};

/**
 * Resolve the declared property type into one of the keys in `INPUT_BY_TYPE`.
 * A declared type that names an enumeration in its package becomes `Enum`;
 * everything else is passed through unchanged so the map (or its `StringInput`
 * default) can handle it.
 */
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
  if (bProp.meta?.hidden) return false;
  if (!bProp.meta?.condition) return true;

  // TODO this is only valid when condition.language is json
  const conditions = bProp.meta?.condition?.body || {};
  const results = Object.entries(conditions).map(([cKey, cExpectedVal]) => {
    const cVal = getProperty(el, cKey);
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
  const Input = INPUT_BY_TYPE[resolvedType] ?? StringInput;

  return (
    <Field className="mx-2 pb-2">
      <Input bpmnProperty={bpmnProperty} />
    </Field>
  );
}
