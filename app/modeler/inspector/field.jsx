import PropTypes from 'prop-types';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { Field } from '@headlessui/react';
import { StringInput } from './StringInput';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';
import { useEffect, useState, useContext, useCallback } from 'react';

import { InspectorContext, ModelerContext } from '../contexts';

export function PropertyField(props) {
    const { bpmnProperty } = props;
    const { element, businessObject } = useContext(InspectorContext);
    const {modeler} = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');

    const propertyType = bpmnProperty.type || 'String';
    const [isVisible, setVisible] = useState(true);

    const checkConditionalVisibility = useCallback((bProp, bObj) => {
        if ("condition" in bProp) {
            const conditions = bProp["condition"]?.body || {};
            const results = Object.entries(conditions).map(([cKey, cExpectedVal]) => {
                // TODO make sure the language of conditions is set to "json"
                const cVal = bObj.get(cKey);
                return cVal === cExpectedVal;
            });
            // visible if all conditions are met
            setVisible(results.every((r) => r));
        }
    }, []);

    // conditional visibility
    useEffect(() => {
        checkConditionalVisibility(bpmnProperty, businessObject);
    }, [bpmnProperty, businessObject, checkConditionalVisibility]);

    useEffect(() => {
        function onElementsChanged(e) {
            const newElement = e.element;
            if (newElement) {
                checkConditionalVisibility(bpmnProperty, getBusinessObject(newElement));
            }
        }
        eventBus.on('element.changed', onElementsChanged);
        return () => {
            eventBus.off('element.changed', onElementsChanged);
        };
    }, [eventBus, bpmnProperty, element, checkConditionalVisibility]);

    function renderInput() {
        //TODO use enumerations in the moddle file to determine if it's enum
        var genericPropertyType = propertyType;
        if (propertyType?.includes('Enum')) {
            genericPropertyType = 'Enum';
        }
        switch (genericPropertyType) {
            case 'Boolean':
                return <BooleanInput {...props} />;
            case 'Enum':
                return <EnumInput {...props} />;
            case 'studyflow:MarkdownString':
                return <StringInput {...props} isMarkdown={true} />;
            default:
                return <StringInput {...props} />;
        }
    }

    return (
        <>
            {isVisible &&
                <Field className="mx-2 pb-2">
                    {renderInput()}
                </Field>
            }
        </>
    );
}

PropertyField.propTypes = {
    bpmnProperty: PropTypes.node.isRequired
}
