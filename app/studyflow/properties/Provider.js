import { InstrumentProps } from './InstrumentProps';
import { UrlProps } from './UrlProps';
import { TextProps } from './TextProps';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

import { useContext, useEffect, useCallback } from 'react';
import { ModelerContext } from '../Contexts';

const PROPERTIES = {
  'studyflow:instrument': InstrumentProps,
  'studyflow:url': UrlProps,
  'studyflow:text': TextProps
};

function getStudyFlowGroup(element, injector) {
  const translate = injector.get('translate');

  var entries = Object.entries(PROPERTIES).map(function ([k, f], i) {
    const obj = getBusinessObject(element);
    const objProps = obj['$descriptor']['propertiesByName'];
    if (k in objProps) {
      return f(element);
    }
  });
    
  entries = entries.flat().filter(ent => ent !== undefined);

  return {
    id: 'studyflow',
    label: translate('StudyFlow'),
    entries: entries,
    // tooltip: '...'
  };
}

export default function PropertiesProvider() {

  const modeler = useContext(ModelerContext);
  const injector = modeler.get('injector');
  const getGroups = useCallback((element) => {
    return (groups) => {
      if (element.type.startsWith('studyflow:')) {
        groups.push(getStudyFlowGroup(element, injector));
      }
      return groups;
    };
  }, [injector]);

  useEffect(() => {
    const propertiesPanel = modeler.get('propertiesPanel');
    propertiesPanel.registerProvider({'getGroups': getGroups});
  }, [modeler, getGroups]);

}
