import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

import { SelectEntry, isSelectEntryEdited } from '@bpmn-io/properties-panel';
import { useService } from 'bpmn-js-properties-panel';
import { useCallback } from '@bpmn-io/properties-panel/preact/hooks';

export function InstrumentProps(element) {

  return [
    {
      id: 'studyflow.instrument_id',
      component: InstrumentId,
      isEdited: isSelectEntryEdited
    }
  ];
}

function InstrumentId(props) {

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

  const getOptions = (element) => {
    return [
      { value: 'NB', label: 'N-Back (NB)' },
      { value: 'DS', label: 'Digit Span (DS)' },
      { value: 'MOT', label: 'Multiple Object Tracking (MOT)' }
    ];
  }

  return SelectEntry({
    element,
    id: 'instrument_id',
    label: 'Instrument',
    getValue,
    setValue,
    debounce,
    getOptions: getOptions,
    'validate': validate,
    tooltip: translate('The name of the Behaverse instrument'),
  });

}
