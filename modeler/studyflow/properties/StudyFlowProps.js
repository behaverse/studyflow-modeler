import { html } from 'htm/preact';

import { TextFieldEntry, isTextFieldEntryEdited } from '@bpmn-io/properties-panel';
import { useService } from 'bpmn-js-properties-panel';

export default function(element) {

  return [
    {
      id: 'studyflow',
      element,
      component: StudyFlow,
      isEdited: isTextFieldEntryEdited
    }
  ];
}

function StudyFlow(props) {
  const { element, id } = props;

  const modeling = useService('modeling');
  const translate = useService('translate');
  const debounce = useService('debounceInput');

  const getValue = () => {
    return element.businessObject.instrument || '';
  };

  const setValue = instrument => {
    return modeling.updateProperties(element, {
      spell: instrument
    });
  };

  return html`<${TextFieldEntry}
    id=${ id }
    element=${ element }
    description=${ translate('Apply an instrument') }
    label=${ translate('Instrument') }
    getValue=${ getValue }
    setValue=${ setValue }
    debounce=${ debounce }
    tooltip=${ translate('Check available instruments.') }
  />`;
}
