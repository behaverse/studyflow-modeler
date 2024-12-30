import studyFlowProps from './StudyFlowProps';

import { is } from 'bpmn-js/lib/util/ModelUtil';

const LOW_PRIORITY = 500;


/**
 * A provider with a `#getGroups(element)` method
 * that exposes groups for a diagram element.
 *
 * @param {PropertiesPanel} propertiesPanel
 * @param {Function} translate
 */
export default function StudyFlowPropertiesProvider(propertiesPanel, translate) {

  // API ////////

  /**
   * Return the groups provided for the given element.
   *
   * @param {DiagramElement} element
   *
   * @return {(Object[]) => (Object[])} groups middleware
   */
  this.getGroups = function(element) {

    /**
     * We return a middleware that modifies
     * the existing groups.
     *
     * @param {Object[]} groups
     *
     * @return {Object[]} modified groups
     */
    return function(groups) {

      if (is(element, 'studyflow:Activity')) {
        groups.push(createStudyFlowGroup(element, translate));
      }

      return groups;
    };
  };

  propertiesPanel.registerProvider(LOW_PRIORITY, this);
}

StudyFlowPropertiesProvider.$inject = [ 'propertiesPanel', 'translate' ];

function createStudyFlowGroup(element, translate) {

  return {
    id: 'studyflow',
    label: translate('StudyFlow properties'),
    entries: studyFlowProps(element),
    tooltip: translate('Make sure you know what you are doing!')
  };

}