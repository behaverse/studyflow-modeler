import { InstrumentProps } from './InstrumentProps';
import { UrlProps } from './UrlProps';
import { TextProps } from './TextProps';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';

const PROPERTIES = {
    'studyflow:instrument': InstrumentProps,
    'studyflow:url': UrlProps,
    'studyflow:text': TextProps
};
  
export default function StudyFlowPropertiesGroup(element) {
    var entries = Object.entries(PROPERTIES).map(function ([k, f]) {
      const bObj = getBusinessObject(element);
      if (k in bObj.$descriptor.propertiesByName) {
        return f(element);
      }
    });
  
    entries = entries.flat().filter(ent => ent !== undefined);
  
    return {
      id: 'studyflow-properties-group',
      label: 'StudyFlow',
      entries: entries,
      collapsed: false,
      // tooltip: '...'
    };
}
  