import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

import { TextAreaEntry, isTextAreaEntryEdited } from '@bpmn-io/properties-panel';
import { useService } from 'bpmn-js-properties-panel';
import { useCallback } from '@bpmn-io/properties-panel/preact/hooks';

export function TextProps(element) {

  return [
    {
      id: 'studyflow.text',
      component: Text,
      isEdited: isTextAreaEntryEdited
    }
  ];
}

function Text(props) {

  const { element } = props;

  const modeling = useService('modeling');
  const debounce = useService('debounceInput');
  const translate = useService('translate');

  const setValue = (value, error) => {
    if (error) {
      return;
    }

    modeling.updateProperties(element, {
      text: value
    });
  };

  const getValue = useCallback((element) => {
    return getBusinessObject(element).instrument;
  }, []);

  const validate = useCallback((value) => {
    const bObj = getBusinessObject(element);
  }, [element]);

  return TextAreaEntry({
    element,
    id: 'text',
    label: 'Text',
    getValue,
    setValue,
    debounce,
    tooltip: translate('Enter the text of the instruction'),
    'validate': validate
  });

}
