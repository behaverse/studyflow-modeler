import PropTypes from 'prop-types';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { Field } from '@headlessui/react';
import { StringInput } from './StringInput';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';
import { useEffect, useState, useContext, useCallback } from 'react';

import { InspectorContext, ModelerContext } from '../contexts';
import { getStudyflowExtension } from '../extensionElements';

/**
 * Check if a property is visible based on its condition.
 * For studyflow properties, conditions are checked against the extension
 * element wrapper, not the business object.
 */
export function isPropertyVisible(bProp, bObjOrExt) {
    if (!bProp || !bObjOrExt) {
        return true;
    }
    if (!("condition" in bProp)) {
        return true;
    }
    const conditions = bProp["condition"]?.body || {};
    const results = Object.entries(conditions).map(([cKey, cExpectedVal]) => {
        const cVal = bObjOrExt.get(cKey);
        if (Array.isArray(cExpectedVal)) {
            return cExpectedVal.includes(cVal);
        }
        return cVal === cExpectedVal;
    });
    // visible if all conditions are met
    return results.every((r) => r);
}

export function PropertyField(props) {
    const { bpmnProperty } = props;
    const { element, businessObject } = useContext(InspectorContext);
    const {modeler} = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');

    const propertyType = bpmnProperty.type || 'String';
    const [isVisible, setVisible] = useState(true);

    // Determine whether to read from the extension element or the business object.
    // Properties defined on studyflow extension types live on the wrapper element,
    // but extends-based props (e.g., isDataOperation) live on the BO itself.
    const isStudyflowProp = bpmnProperty.ns?.prefix === 'studyflow';
    const isExtendsProp = businessObject?.$descriptor?.properties?.some(
        (p) => p === bpmnProperty
    );

    const checkConditionalVisibility = useCallback((bProp, bObj) => {
        // For extension-element studyflow props, check conditions against the wrapper;
        // for extends-based props, check conditions against the BO.
        const dataSource = (isStudyflowProp && !isExtendsProp)
            ? getStudyflowExtension(bObj) || bObj
            : bObj;
        setVisible(isPropertyVisible(bProp, dataSource));
    }, [isStudyflowProp, isExtendsProp]);

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
        //TODO use enumerations in the schema file to determine if it's enum
        //     currently we use a naming convention
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
