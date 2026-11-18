import { createElement, useState } from 'react';
import type { ChangeEvent, ComponentType } from 'react';
import { Checkbox, Label, Textarea } from '@headlessui/react';
import { WIDGET_NAMES, type AttributeSpec, type WidgetName } from '@core/notation';
import { t } from '@modeler/i18n';
import { ICONS } from '@modeler/icons';
import { executeCommand } from '@modeler/commandBus';
import { ArrayInput, ChecklistInput, EnumInput, EnumListInput, ExpressionInput } from '@modeler/inspector/inputs';
import { CodeEditor, SchemaEditor } from '@modeler/inspector/editors';
import { CheckIcon, HelpTooltip } from '@modeler/inspector/widgets';
import { WrapInput } from '@modeler/inspector/WrapInput';
import { useAttributeState, useInspectedElement, useInspectedModel } from '@modeler/inspector/hooks';
import { readAttribute } from '@core/model/index';
import type { Element } from '@core/model/index';
import type { AttributeOverride } from '@core/model/parameters';
import { resolvePlaceholdersIn } from '@core/model/state';
import { field as s } from '@modeler/inspector/styles';

const TYPING_DEBOUNCE_MS = 400;

function StringInput({ attrDef, isMarkdown }: { attrDef: AttributeSpec; isMarkdown?: boolean }) {
  const { value, commit, flush } = useAttributeState<string>(
    attrDef,
    (raw) => raw || '',
    { debounceMs: TYPING_DEBOUNCE_MS },
  );
  const name = attrDef.ns.name;
  // An element's id shows, to read and to copy: the study sets no id (`set` refuses it), so typing one would be lost.
  const fixed = attrDef.isId === true || name === 'bpmn:id';
  const element = useInspectedElement();
  const model = useInspectedModel();
  // `{count}` shows its run-state value under the input; the input itself keeps the placeholder.
  // `raw || ''` passes numbers through (an Integer attribute like `seed`), so guard the type.
  const resolved = typeof value === 'string' && value.includes('{')
    ? resolvePlaceholdersIn(model, value, element?.id ?? '')
    : value;

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    commit(e.target.value);
  }

  return (
    <>
      <Label className={s.label}>
        <span>
          {t(attrDef)}
          {attrDef.meta?.unit && <span className={s.unit}>{attrDef.meta.unit}</span>}
        </span>
        <HelpTooltip name={name} description={attrDef?.description} />
      </Label>
      {isMarkdown ? (
        <Textarea name={name} onChange={handleChange} onBlur={flush} value={value} rows={4} className={s.textArea} />
      ) : (
        <WrapInput name={name} onChange={handleChange} onBlur={flush} value={String(value ?? '')} className={s.textInput} readOnly={fixed} />
      )}
      {resolved !== value && (
        <div className="px-1 text-[0.6875rem] text-stone-500 truncate" title={resolved}>→ {resolved}</div>
      )}
    </>
  );
}

function BooleanInput({ attrDef }: { attrDef: AttributeSpec }) {
  const { value, commit } = useAttributeState<boolean>(attrDef, (raw) => !!raw);
  const name = attrDef.ns.name;

  return (
    <div className={s.booleanRow}>
      <span className={s.booleanGroup}>
        <Checkbox checked={value} onChange={commit} className={s.checkbox}>
          <CheckIcon />
        </Checkbox>
        <Label className={s.checkLabel}>{t(attrDef)}</Label>
      </span>
      <HelpTooltip name={name} description={attrDef?.description} wide={false} />
    </div>
  );
}

function OptionalStringInput({ attrDef }: { attrDef: AttributeSpec }) {
  const { value, commit, element } = useAttributeState<string | undefined>(
    attrDef,
    (raw) => (raw == null ? undefined : String(raw)),
  );
  const name = attrDef.ns.name;
  // The study keeps no empty value, so a field ticked and not yet typed into is open here alone, for this element.
  const [openFor, setOpenFor] = useState<unknown>(undefined);
  const isSet = value !== undefined || (openFor !== undefined && openFor === element?.id);

  function handleToggle(checked: boolean) {
    setOpenFor(checked ? element?.id : undefined);
    if (!checked) commit(undefined);
  }

  function handleTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    commit(e.target.value);
  }

  return (
    <>
      <div className={s.booleanRow}>
        <span className={s.booleanGroup}>
          <Checkbox checked={isSet} onChange={handleToggle} className={s.checkbox}>
            <CheckIcon />
          </Checkbox>
          <Label className={s.checkLabel}>{t(attrDef)}</Label>
        </span>
        <HelpTooltip name={name} description={attrDef?.description} />
      </div>
      {isSet && (
        <WrapInput
          name={name}
          onChange={handleTextChange}
          value={value ?? ''}
          className={s.textInput}
        />
      )}
    </>
  );
}

/** An attribute a Parameters object sets: its value shown, never edited here, with the object that sets it one click away. */
export function OverriddenInput({ attrDef, override }: { attrDef: AttributeSpec; override: AttributeOverride }) {
  const { element, modeler } = useAttributeState<unknown>(attrDef, (raw) => raw);
  const model = useInspectedModel();
  const name = attrDef.ns.name;
  const shown = typeof override.value === 'string' ? override.value : JSON.stringify(override.value);
  const own = readAttribute(model, element, name);
  const source = (from: Element) => {
    const label = String(from.name || from.id);
    return (
      <button
        key={String(from.id)}
        type="button"
        className={s.overriddenSource}
        title={`Select ${label}`}
        onClick={() => executeCommand(modeler, { type: 'SelectElement', id: String(from.id) })}
      >
        {label}
      </button>
    );
  };
  const [first, ...others] = override.sources;
  return (
    <>
      <Label className={s.label}>
        <span className={s.overriddenLabel}>
          <i className={`${ICONS.wired} text-xs text-stone-500`} aria-hidden="true" />
          {t(attrDef)}
          {attrDef.meta?.unit && <span className={s.unit}>{attrDef.meta.unit}</span>}
        </span>
        <HelpTooltip name={name} description={attrDef?.description} />
      </Label>
      <WrapInput name={name} value={shown} readOnly disabled className={s.overriddenInput} />
      <div className={s.overriddenNote} data-testid={`overridden-${attrDef.ns.localName}`}>
        Set by {first && source(first)}
        {others.length > 0 && <> and {others.map(source)}, which a run refuses</>}
        {' '}(<code>{override.attribute}</code>); edit it there, not here.
        {own != null && own !== '' && String(own) !== shown && (
          <> This element's own value, <code>{String(own)}</code>, is not used.</>
        )}
      </div>
    </>
  );
}

const MarkdownStringInput = (inputProps: any) => <StringInput {...inputProps} isMarkdown />;

/** The inputs a schema names in `meta.widget`; keyed by core's `WidgetName` so the lists cannot drift. */
const INPUT_BY_WIDGET: Record<WidgetName, ComponentType<{ attrDef: AttributeSpec }>> = {
  'csvw-table': SchemaEditor,
  'code': CodeEditor,
  'markdown': MarkdownStringInput,
  'checklist': ChecklistInput,
};

function namedInput(name: string | undefined) {
  return name && (WIDGET_NAMES as readonly string[]).includes(name)
    ? INPUT_BY_WIDGET[name as WidgetName]
    : undefined;
}

/**
 * The editor for one attribute, chosen by {@link pickInput}.
 *
 * The picker itself stays private: a `.tsx` module that exports anything but
 * components loses React Fast Refresh for the whole file, and this one is nothing but
 * editors.
 */
export function AttributeInput({ attrDef }: { attrDef: AttributeSpec }) {
  // `createElement` rather than a capitalized local: react-hooks would read the latter
  // as a component defined during render.
  return createElement(pickInput(attrDef), { attrDef });
}

function pickInput(attrDef: AttributeSpec) {
  if (attrDef.meta?.expression) return ExpressionInput;

  const named = namedInput(attrDef.meta?.widget);
  if (named) return named;

  const declaredType = attrDef.type || 'String';
  const isStringList = attrDef.isMany === true
    && (declaredType === 'String' || declaredType.endsWith(':MarkdownString'));
  const isNullableString = attrDef.meta?.nullable === true && declaredType === 'String';

  if (isNullableString) return OptionalStringInput;
  if (isStringList) return ArrayInput;
  if (attrDef.isEnum && attrDef.isMany) return EnumListInput;
  if (attrDef.isEnum) return EnumInput;
  if (declaredType === 'Boolean') return BooleanInput;

  return namedInput(attrDef.typeWidget) ?? StringInput;
}
