import { InstrumentProps } from './InstrumentProps';

function getStudyFlowGroup(element, injector) {
  const translate = injector.get('translate');
  return {
    id: 'studyflow',
    label: translate('StudyFlow'),
    entries: InstrumentProps(element),
    // tooltip: '...'
  };
}

export default class PropertiesProvider {

  static $inject = ['propertiesPanel', 'injector'];

  constructor(propertiesPanel, injector) {
    propertiesPanel.registerProvider(this);
    this._injector = injector;
  }

  getGroups(element) {
    return (groups) => {
      if (element.type.startsWith('studyflow:')) {
        groups.push(getStudyFlowGroup(element, this._injector));
      }
      return groups;
    };
  }
}
