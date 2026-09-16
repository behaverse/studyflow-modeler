import { t } from '@modeler/i18n';
import { getCatalog } from '@core/notation';
import { executeCommand } from '@modeler/commandBus';
import { useModeler } from '@modeler/app/useModeler';
import { HelpTooltip } from '@modeler/inspector/widgets';
import { PlainEnumSelect, toOptions } from '@modeler/inspector/inputs';
import { messageStructureOf } from '@modeler/inspector/stateProperties';
import { field as s } from '@modeler/inspector/styles';

const MESSAGE_DESCRIPTION = 'What this flow carries: the structure its message is an item of, by the name a runner '
  + 'recognises. Unnamed, the flow is taken for whichever fits.';

/** A message flow's `messageRef`, picked among the structures the loaded schemas' `MessageStructureEnum` declares. */
export function MessageSection({ element }: { element: any }) {
  const modeler = useModeler();
  const businessObject = element?.businessObject ?? element;
  if (businessObject?.$type !== 'bpmn:MessageFlow') return null;
  const structures = [{ name: 'unnamed', value: '' }, ...toOptions(getCatalog().enumOf('MessageStructureEnum')?.literals)];

  return (
    <div className={s.field} data-testid="message-section">
      <div className={s.label}>
        {t('messageRef')}
        <HelpTooltip name="messageRef" description={MESSAGE_DESCRIPTION} />
      </div>
      <PlainEnumSelect
        name="messageRef"
        ariaLabel="Message"
        value={messageStructureOf(businessObject)}
        literalValues={structures}
        onCommit={(structureRef) => executeCommand(modeler, { type: 'UpdateMessage', element, structureRef })}
      />
    </div>
  );
}
