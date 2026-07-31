import { Field, Label } from '@headlessui/react';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { useModeler } from '@/modeler/views/useModeler';
import { ExpressionRow } from '@/modeler/views/inspector/ExpressionInput';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { field as s } from '@/modeler/infra/styles';

const DESCRIPTION = 'The association\u2019s one expression \u2014 BPMN\u2019s own '
  + 'transformation element. Its body is `slot = selection`, each half optional: '
  + 'the slot names which callable parameter the value fills, the selection '
  + 'narrows what value arrives (member access and indexing only \u2014 wires '
  + 'coordinate, steps calculate). On an output the drawn target is the slot, '
  + 'so the body is a selection over `result`.';

const ASSOCIATION_TYPES = new Set(['bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation']);

/**
 * The selected wire\u2019s own `transformation`, edited in place. Nothing is
 * declared in a schema for this \u2014 the element is the standard\u2019s own,
 * used as-is, which is also why the language select rides here: BPMN\u2019s
 * per-expression `language` field lives on this very element.
 */
export function WireTransformationSection({ element }: { element: any }) {
  const modeler = useModeler();
  const businessObject = element?.businessObject ?? element;
  if (!ASSOCIATION_TYPES.has(businessObject?.$type)) return null;

  const expression = businessObject.get?.('transformation') ?? businessObject.transformation;
  const body: string = expression?.get?.('body') ?? expression?.body ?? '';
  const language: string = expression?.get?.('language') ?? expression?.language ?? '';
  const isOutput = businessObject.$type === 'bpmn:DataOutputAssociation';
  // The placeholder is the default that applies when nothing is written: an
  // output lands the whole `result`; an input binds by the source element's
  // own name (the same chain the exporter's `effectiveSlot` resolves).
  const source = businessObject.get?.('sourceRef')?.[0] ?? businessObject.sourceRef?.[0];
  const placeholder = isOutput ? 'result' : source?.name || source?.id || 'input';

  return (
    <Field className={s.field}>
      <Label className={s.label}>
        Transformation
        <HelpTooltip name="transformation" description={DESCRIPTION} />
      </Label>
      <ExpressionRow
        name="bpmn:transformation"
        placeholder={placeholder}
        value={body}
        language={language}
        onCommit={(next) => executeCommand(modeler, {
          type: 'update-transformation', element, field: 'body', value: next,
        })}
        onCommitLanguage={(next) => executeCommand(modeler, {
          type: 'update-transformation', element, field: 'language', value: next,
        })}
      />
    </Field>
  );
}
