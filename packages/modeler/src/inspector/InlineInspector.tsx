/**
 * The inline inspector: what a person sets on most steps, where the step is. While the inspector is closed it sits
 * under the context pad's actions (and in a storyboard's selected step): the step's name and the fields its type's
 * schema marks `showInline` (skills/SCHEMAS.md), edited with the inspector's own inputs; All properties opens the
 * inspector.
 */

import { useEffect, useReducer } from 'react';
import { Field } from '@headlessui/react';
import { useModeler } from '@modeler/app/useModeler';
import { ICONS } from '@modeler/icons';
import { inlineFields } from '@modeler/inspector/categories';
import { InspectorContext } from '@modeler/inspector/hooks';
import { AttributeInput } from '@modeler/inspector/registry';
import { field as fld, inline as s } from '@modeler/inspector/styles';
import { showInspector } from '@modeler/inspector/visibility';

/** The fields under the pad's actions, read again after every edit, and the way to the rest. */
export function InlineInspector({ id }: { id: string }) {
  const modeler = useModeler();
  const [, refresh] = useReducer((version: number) => version + 1, 0);
  useEffect(() => modeler.study.on('change', refresh), [modeler]);
  const { model } = modeler.study;
  const element = modeler.study.element(id);
  if (!element) return null;

  return (
    <InspectorContext.Provider value={{ element, model }}>
      <div className={s.fields} data-testid="inline-inspector">
        {inlineFields(model, element).map((attrDef) => (
          <Field key={`${id}:${attrDef.ns?.name ?? attrDef.name}`} className={fld.field}>
            <AttributeInput attrDef={attrDef} />
          </Field>
        ))}
      </div>
      <button type="button" className={s.more} onClick={() => showInspector(true)}>
        All properties
        <i className={ICONS.chevronRight} aria-hidden="true" />
      </button>
    </InspectorContext.Provider>
  );
}
