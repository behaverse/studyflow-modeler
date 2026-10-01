/** The transformation of a data association, the inspector's one field for a wire: `slot = selection`. */
import { Field, Label } from '@headlessui/react';
import { executeCommand } from '@modeler/commandBus';
import { useModeler } from '@modeler/app/useModeler';
import { ExpressionRow } from '@modeler/inspector/inputs';
import { useInspectedModel } from '@modeler/inspector/hooks';
import { idOf, isElement } from '@core/model/index';
import { HelpTooltip } from '@modeler/inspector/widgets';
import { field as fld } from '@modeler/inspector/styles';

const TRANSFORMATION_DESCRIPTION = '`slot = selection` with '
  + 'each half optional: the slot names the parameter to fill, the selection narrows the '
  + 'value that arrives.';

const ASSOCIATION_TYPES = new Set(['bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation']);

export function WireTransformationSection({ element }: { element: any }) {
  const modeler = useModeler();
  const model = useInspectedModel();
  if (!element || !ASSOCIATION_TYPES.has(model.host(element))) return null;

  const expression = element.transformation;
  const body: string = (isElement(expression) ? expression.body : expression) as string ?? '';
  const isOutput = model.host(element) === 'bpmn:DataOutputAssociation';
  const source = model.get(idOf([element.sourceRef].flat()[0]) ?? undefined);
  const placeholder = isOutput ? 'result' : String(source?.name || source?.id || 'input');

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
