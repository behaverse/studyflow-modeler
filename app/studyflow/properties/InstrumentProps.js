import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

import { SelectEntry, isSelectEntryEdited } from '@bpmn-io/properties-panel';

import { useService } from 'bpmn-js-properties-panel';
import { useCallback } from '@bpmn-io/properties-panel/preact/hooks';

export function InstrumentProps(element) {

  const bObj = getBusinessObject(element);

  if (bObj.$type !== 'studyflow:CognitiveTest'
    && bObj.$type !== 'studyflow:Questionnaire'
  ) {
    return [];
  }

  let components = [
    {
      id: 'studyflow.instrument_id',
      component: InstrumentId,
      isEdited: isSelectEntryEdited
    }
  ];

  if (bObj.instrument == 'behaverse') {
    components.push({
      id: 'studyflow.behaverse_instrument_id',
      component: BehaverseInstrumentId,
      isEdited: isSelectEntryEdited
    });
  }

  return components;
}

function InstrumentId(props) {

  const { element } = props;

  const modeling = useService('modeling');
  const debounce = useService('debounceInput');
  const translate = useService('translate');
  const moddle = useService('moddle');

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
    //TODO: hardcoded! read from enumerations rather than types
    const opts = moddle.registry.typeMap['studyflow:InstrumentType'].literalValues;
    return opts.map((opt) => {
      return {
        value: opt.value,
        label: opt.name
      };
    });
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
    tooltip: translate('Type of the instrument'),
  });

}


function BehaverseInstrumentId(props) {

  const { element } = props;

  const modeling = useService('modeling');
  const debounce = useService('debounceInput');
  const translate = useService('translate');
  const moddle = useService('moddle');

  const setValue = (value, error) => {
    if (error) {
      return;
    }

    modeling.updateProperties(element, {
      behaverse_instrument: value
    });
  };

  const getValue = useCallback((element) => {
    return getBusinessObject(element).behaverse_instrument;
  }, []);

  const validate = useCallback((value) => {
    const obj = getBusinessObject(element);
    // return true;
  }, [element]);

  const getOptions = (element) => {
    //TODO: hardcoded! read from enumerations rather than types
    const opts = moddle.registry.typeMap['studyflow:BehaverseInstrumentType'].literalValues;
    return opts.map((opt) => {
      return {
        value: opt.value,
        label: opt.name
      };
    });
  }

  return SelectEntry({
    element,
    id: 'behaverse_instrument_id',
    label: 'Behaverse Instrument',
    getValue,
    setValue,
    debounce,
    getOptions: getOptions,
    'validate': validate,
    tooltip: translate('The name of the Behaverse instrument'),
  });

}
