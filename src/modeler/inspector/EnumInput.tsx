import { Select, Label } from '@headlessui/react';
import { useContext, useState, type ChangeEvent } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '../extensions';
import { executeCommand } from '../commands';
import { toLocalName, toPrefix } from '../utils/naming';
import { field as s } from '../styles';

type Props = {
  bpmnProperty: any;
};

/**
 * Resolve the values for an enum-typed property, supporting types
 * defined in a different moddle package than the property itself
 * (e.g. `studyflow:CognitiveTask.scene` -> `behaverse:BehaverseSceneEnum`).
 */
function resolveEnumLiterals(bpmnProperty: any, modeler: any): any[] | null {
  const propertyType: string = bpmnProperty.type ?? '';
  const localName = toLocalName(propertyType);
  const targetPrefix = toPrefix(propertyType) ?? null;

  const definingPkg = bpmnProperty.definedBy?.$pkg;
  if (!targetPrefix || targetPrefix === definingPkg?.prefix) {
    return definingPkg?.enumerations?.find((e: any) => e.name === localName)?.literalValues ?? null;
  }

  const moddle = modeler?.get?.('moddle');
  if (!moddle) return null;

  const pkg =
    typeof moddle.getPackage === 'function'
      ? moddle.getPackage(targetPrefix)
      : (moddle.packages ? moddle.packages[targetPrefix] : undefined);

  return pkg?.enumerations?.find((e: any) => e.name === localName)?.literalValues ?? null;
}

export function EnumInput({ bpmnProperty }: Props) {
  const { element } = useContext(InspectorContext);
  const { modeler } = useContext(ModelerContext);

  const name = bpmnProperty.ns?.name ?? bpmnProperty.name;
  const propertyType = toLocalName(bpmnProperty.type);
  const literalValues = resolveEnumLiterals(bpmnProperty, modeler) ?? [];
  const [value, setValue] = useState<string>(getProperty(element, name) || '');

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const newValue = event.target.value;
    setValue(newValue);
    executeCommand(modeler, {
      type: 'update-property',
      element,
      propertyName: name,
      value: newValue,
    });
  }

  return (
    <>
      <Label className={s.label}>
        {t(bpmnProperty.ns.name)}
        <div className={s.helpAnchor}>
          <i className={s.helpIcon}></i>
          <div className={s.helpTooltip}>
            <pre className={s.helpTooltipName}>{bpmnProperty.ns.name}</pre>
            {bpmnProperty?.description}
          </div>
        </div>
      </Label>
      <div className={s.selectWrapper}>
        <Select
          name={bpmnProperty.ns.name}
          aria-label={t(bpmnProperty.ns.name)}
          onChange={handleChange}
          value={value}
          className={s.select}
        >
          {literalValues.map((l: any) => (
            <option key={l.value} value={l.value}>{l.name}</option>
          ))}
        </Select>
        <i className={s.selectChevron} aria-hidden="true"></i>
      </div>
    </>
  );
}
