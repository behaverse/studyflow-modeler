/** The transformation of a data association, the inspector's one field for a wire: `slot = selection`. */
import { Field, Label } from '@headlessui/react';
import { executeCommand } from '@modeler/commandBus';
import { useModeler } from '@modeler/app/useModeler';
import { ExpressionRow } from '@modeler/inspector/inputs';
import { HelpTooltip } from '@modeler/inspector/widgets';
import { field as fld } from '@modeler/inspector/styles';

const TRANSFORMATION_DESCRIPTION = '`slot = selection` with '
  + 'each half optional: the slot names the parameter to fill, the selection narrows the '
  + 'value that arrives.';

const ASSOCIATION_TYPES = new Set(['bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation']);

export function WireTransformationSection({ element }: { element: any }) {
  const modeler = useModeler();
  const businessObject = element?.businessObject ?? element;
  if (!ASSOCIATION_TYPES.has(businessObject?.$type)) return null;

  const expression = businessObject.get?.('transformation') ?? businessObject.transformation;
  const body: string = expression?.get?.('body') ?? expression?.body ?? '';
  const isOutput = businessObject.$type === 'bpmn:DataOutputAssociation';
  const source = businessObject.get?.('sourceRef')?.[0] ?? businessObject.sourceRef?.[0];
  const placeholder = isOutput ? 'result' : source?.name || source?.id || 'input';

  return (
    <Field className={fld.field}>
      <Label className={fld.label}>
        Transformation
        <HelpTooltip name="transformation" description={TRANSFORMATION_DESCRIPTION} />
      </Label>
      <ExpressionRow
        name="bpmn:transformation"
        placeholder={placeholder}
        value={body}
        onCommit={(next) => executeCommand(modeler, {
          type: 'UpdateTransformation', element, field: 'body', value: next,
        })}
      />
    </Field>
  );
}

