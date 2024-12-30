import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

import { TextFieldEntry, isTextFieldEntryEdited } from '@bpmn-io/properties-panel';
import { useService } from 'bpmn-js-properties-panel';
import { useCallback } from '@bpmn-io/properties-panel/preact/hooks';

export function InstrumentProps(element) {

  return [
    {
      id: 'studyflow.instrument',
      component: Instrument,
      isEdited: isTextFieldEntryEdited
    }
  ];
}

function Instrument(props) {

  const { element } = props;

  const modeling = useService('modeling');
  const debounce = useService('debounceInput');
  const translate = useService('translate');

  const setValue = (value, error) => {
    if (error) {
      return;
    }

    modeling.updateProperties(element, {
      instrument: value
    });
  };

  const getValue = useCallback((element) => {
    return getBusinessObject(element).instrument;
  }, []);

  const validate = useCallback((value) => {
    const obj = getBusinessObject(element);
    // return true;
  }, [element]);

  return TextFieldEntry({
    element,
    id: 'instrument',
    label: 'Instrument',
    getValue,
    setValue,
    debounce,
    tooltip: translate('The name of the Behaverse instrument'),
    'validate': validate
  });

}
