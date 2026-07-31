import { Field, Label, Textarea } from '@headlessui/react';
import type { ChangeEvent } from 'react';
import { useState } from 'react';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { getAttribute, getExpressionLanguage } from '@/core/extensions';
import { t } from '@/i18n';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { useInspectedElement } from '@/modeler/views/inspector/hooks/useInspectedElement';
import { useModeler } from '@/modeler/views/useModeler';
import { field as s } from '@/modeler/infra/styles';

/**
 * The one way an expression renders, wherever it lives — a flow's condition,
 * a timer, the loop marker's condition, a wire's transformation. One row:
 * the compact language selector on the left (`—` is native, the evaluating
 * engine's own language; never validated here, only by the engine that
 * eventually evaluates), the expression beside it. The text box is a
 * one-line textarea so a long expression wraps instead of clipping; Enter is
 * a no-op and pasted newlines collapse, since these are expressions, not
 * prose.
 */
export function ExpressionRow({ name, placeholder, value, language, onCommit, onCommitLanguage }: {
  name: string;
  placeholder?: string;
  value: string;
  language: string;
  onCommit: (next: string) => void;
  onCommitLanguage: (next: string | undefined) => void;
}) {
  return (
    <div className="flex items-stretch gap-1">
      <select
        aria-label="Expression language"
        value={language}
        disabled={!value}
        title={value
          ? 'Expression language \u2014 dash is native (the engine\u2019s own)'
          : 'Type an expression first'}
        onChange={(e) => onCommitLanguage(e.target.value || undefined)}
        className="shrink-0 w-11 rounded-md border border-black/[0.08] bg-cream-200
          text-[10px] text-stone-500 px-1 cursor-pointer focus:outline-2
          focus:-outline-offset-2 focus:outline-cream-400 disabled:opacity-40
          disabled:cursor-default"
      >
        <option value="">-</option>
        <option value="python">PY</option>
        <option value="javascript">JS</option>
      </select>
      <Textarea
        name={name}
        rows={1}
        placeholder={placeholder}
        value={value}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onCommit(e.target.value.replace(/\s*\n\s*/g, ' '))}
        className={`${s.textInput} flex-1`}
      />
    </div>
  );
}

/** {@link ExpressionRow} bound to a catalog attribute — what `pickInput`
 *  returns for every `meta.expression` attribute, so a schema marks an
 *  expression once and rendering is nobody else\u2019s business. */
export function ExpressionInput({ attrDef }: { attrDef: any }) {
  const element = useInspectedElement();
  const modeler = useModeler();
  const attributeName = attrDef.ns?.name ?? attrDef.name;

  const [value, setValue] = useState<string>(() => {
    const raw = getAttribute(element, attributeName);
    return typeof raw === 'string' ? raw : '';
  });
  const [language, setLanguage] = useState<string>(
    () => getExpressionLanguage(element, attributeName) ?? '',
  );

  return (
    <Field className={s.field}>
      <Label className={s.label}>
        {t(attributeName)}
        <HelpTooltip name={attributeName} description={attrDef?.description} />
      </Label>
      <ExpressionRow
        name={attributeName}
        value={value}
        language={language}
        onCommit={(next) => {
          setValue(next);
          executeCommand(modeler, { type: 'update-attribute', element, attributeName, value: next });
        }}
        onCommitLanguage={(next) => {
          setLanguage(next ?? '');
          executeCommand(modeler, {
            type: 'update-expression-language', element, attributeName, language: next,
          });
        }}
      />
    </Field>
  );
}
