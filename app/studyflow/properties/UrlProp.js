import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

import { TextAreaEntry, isTextAreaEntryEdited } from '@bpmn-io/properties-panel';
import { useService } from 'bpmn-js-properties-panel';
import { useCallback } from '@bpmn-io/properties-panel/preact/hooks';

export function UrlProps(element) {

  return [
    {
      id: 'studyflow.url',
      component: Url,
      isEdited: isTextAreaEntryEdited
    }
  ];
}

function Url(props) {

  const { element } = props;

  const modeling = useService('modeling');
  const debounce = useService('debounceInput');
  const translate = useService('translate');

  const setValue = (value, error) => {
    if (error) {
      return;
    }

    modeling.updateProperties(element, {
      url: value
    });
  };

  const getValue = useCallback((element) => {
    return getBusinessObject(element).url;
  }, []);

  const validate = useCallback((value) => {
    const obj = getBusinessObject(element);
    // return true;
  }, [element]);

  return TextAreaEntry({
    element,
    id: 'url',
    label: 'URL',
    getValue: getValue,
    setValue: setValue,
    debounce,
    monospace: true,
    tooltip: translate('Enter the URL of the activity'),
    'validate': validate
  });

}
