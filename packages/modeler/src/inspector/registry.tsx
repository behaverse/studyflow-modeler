import { createElement } from 'react';
import type { ChangeEvent, ComponentType } from 'react';
import { Checkbox, Input, Label, Textarea } from '@headlessui/react';
import { EDITOR_NAMES, type AttributeSpec, type EditorName } from '@core/notation';
import { t } from '@modeler/i18n';
import { ArrayInput, ChecklistInput, EnumInput, ExpressionInput } from '@modeler/inspector/inputs';
import { CodeEditor, SchemaEditor } from '@modeler/inspector/editors';
import { CheckIcon, HelpTooltip } from '@modeler/inspector/widgets';
import { useAttributeState } from '@modeler/inspector/state';
import { field as s } from '@modeler/inspector/styles';

const TYPING_DEBOUNCE_MS = 400;

function StringInput({ attrDef, isMarkdown }: { attrDef: AttributeSpec; isMarkdown?: boolean }) {
  const { value, commit, flush } = useAttributeState<string>(
    attrDef,
    (raw) => raw || '',
    { debounceMs: TYPING_DEBOUNCE_MS },
  );
  const name = attrDef.ns.name;

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    commit(e.target.value);
  }

  return (
    <>
      <Label className={s.label}>
        <span>
          {t(name)}
          {attrDef.meta?.unit && <span className={s.unit}>{attrDef.meta.unit}</span>}
        </span>
        <HelpTooltip name={name} description={attrDef?.description} />
      </Label>
      {isMarkdown ? (
        <Textarea name={name} onChange={handleChange} onBlur={flush} value={value} rows={4} className={s.textArea} />
      ) : (
        <Input name={name} type="text" onChange={handleChange} onBlur={flush} value={value} className={s.textInput} />
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
        <Label className={s.label}>{t(name)}</Label>
      </span>
      <HelpTooltip name={name} description={attrDef?.description} wide={false} />
    </div>
  );
}

function OptionalStringInput({ attrDef }: { attrDef: AttributeSpec }) {
  const { value, commit } = useAttributeState<string | undefined>(
    attrDef,
    (raw) => (raw == null ? undefined : String(raw)),
  );
  const name = attrDef.ns.name;
  const isSet = value !== undefined;

  function handleToggle(checked: boolean) {
    commit(checked ? '' : undefined);
  }

  function handleTextChange(e: ChangeEvent<HTMLInputElement>) {
    commit(e.target.value);
  }

  return (
    <>
      <div className={s.booleanRow}>
        <span className={s.booleanGroup}>
          <Checkbox checked={isSet} onChange={handleToggle} className={s.checkbox}>
            <CheckIcon />
          </Checkbox>
          <Label className={s.label}>{t(name)}</Label>
        </span>
        <HelpTooltip name={name} description={attrDef?.description} />
      </div>
      {isSet && (
        <Input
          name={name}
          type="text"
          onChange={handleTextChange}
          value={value ?? ''}
          className={s.textInput}
        />
      )}
    </>
  );
}

function ReadonlyInput({ attrDef }: { attrDef: AttributeSpec }) {
  const { value } = useAttributeState<string>(attrDef, (raw) => (raw == null ? '' : String(raw)));
  const name = attrDef.ns.name;

  return (
    <>
      <Label className={s.label}>
        {t(name)}
        <HelpTooltip name={name} description={attrDef?.description} />
      </Label>
      <Input
        name={name}
        type="text"
        value={value}
        readOnly
        disabled
        placeholder="written at run time"
        className={s.textInput}
      />
    </>
  );
}

const MarkdownStringInput = (inputProps: any) => <StringInput {...inputProps} isMarkdown />;

/** Editors addressable from schema `meta.editor`; keyed by core's `EditorName` so the lists cannot drift. */
const INPUT_BY_EDITOR_NAME: Record<EditorName, ComponentType<{ attrDef: AttributeSpec }>> = {
  'csvw-table': SchemaEditor,
  'code': CodeEditor,
  'markdown': MarkdownStringInput,
  'checklist': ChecklistInput,
};

function namedInput(name: string | undefined) {
  return name && (EDITOR_NAMES as readonly string[]).includes(name)
    ? INPUT_BY_EDITOR_NAME[name as EditorName]
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
  if (attrDef.meta?.readonly) return ReadonlyInput;
  if (attrDef.meta?.expression) return ExpressionInput;

  const named = namedInput(attrDef.meta?.editor);
  if (named) return named;

  const declaredType = attrDef.type || 'String';
  const isStringList = attrDef.isMany === true
    && (declaredType === 'String' || declaredType.endsWith(':MarkdownString'));
  const isOptionalString = attrDef.meta?.optional === true && declaredType === 'String';

  if (isOptionalString) return OptionalStringInput;
  if (isStringList) return ArrayInput;
  if (attrDef.isEnum) return EnumInput;
  if (declaredType === 'Boolean') return BooleanInput;

  return namedInput(attrDef.typeEditor) ?? StringInput;
}
