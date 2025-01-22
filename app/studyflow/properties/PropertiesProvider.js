
import StudyFlowPropertiesGroup from './Group';
import { useContext, useEffect, useCallback } from 'react';
import { ModelerContext } from '../../contexts';

export default function PropertiesProvider() {

  const modeler = useContext(ModelerContext);
  const injector = modeler.get('injector');

  const getGroups = useCallback((element) => {
    return (groups) => {
      if (element.type.startsWith('studyflow:')) {
        const group = StudyFlowPropertiesGroup(element, injector);
        groups.push(group);
      }
      return groups;
    };
  }, [injector]);

  // register provider
  useEffect(() => {
    const propertiesPanel = modeler.get('propertiesPanel');
    propertiesPanel.registerProvider({'getGroups': getGroups});
  }, [modeler, getGroups]);

}
