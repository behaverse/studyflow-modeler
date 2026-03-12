import PropTypes from 'prop-types';
import { Field } from '@headlessui/react';
import { StringInput } from './StringInput';
import { SchemaEditor } from './SchemaEditor';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';
import { useEffect, useState, useContext, useCallback } from 'react';

import { InspectorContext, ModelerContext } from '../contexts';
import { getProperty } from '../extensionElements';

/**
 * Check if a property is visible based on its condition.
 * For studyflow properties, conditions are checked against the extension
 * element wrapper, not the business object.
 */
export function isPropertyVisible(bProp, el) {
    if (!bProp || !el) {
        return true;
    }
    if (bProp.meta?.hidden) {
        return false;
    }
    if (!bProp.meta?.condition) {
        return true;
    }

    // TODO this is only valid when condition.language is json
    const conditions = bProp.meta?.condition?.body || {};
    const results = Object.entries(conditions).map(([cKey, cExpectedVal]) => {
        const cVal = getProperty(el, cKey);
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
    const { element } = useContext(InspectorContext);
    const {modeler} = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');

    const propertyType = bpmnProperty.type || 'String';
    const [isVisible, setVisible] = useState(true);

    // Determine whether to read from the extension element or the business object.
    // Properties defined on studyflow extension types live on the wrapper element,
    // but extends-based props (e.g., isDataOperation) live on the BO itself.
    const checkConditionalVisibility = useCallback((bProp, element) => {
        setVisible(isPropertyVisible(bProp, element));
    }, []);

    // conditional visibility
    useEffect(() => {
        checkConditionalVisibility(bpmnProperty, element);
    }, [bpmnProperty, element, checkConditionalVisibility]);

    useEffect(() => {
        function onElementsChanged(e) {
            const newElement = e.element;
            if (newElement) {
                checkConditionalVisibility(bpmnProperty, newElement);
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
        const [pkg, name] = propertyType.split(':');

        if (modeler.get('moddle').getPackage(pkg)?.enumerations?.some(
            e => e.name === name)) {
            genericPropertyType = 'Enum';
        }

        switch (genericPropertyType) {
            case 'Boolean':
                return <BooleanInput {...props} />;
            case 'Enum':
                return <EnumInput {...props} />;
            case 'studyflow:Schema':
                return <SchemaEditor {...props} />;
            case 'studyflow:MarkdownString':
            case 'studyflow:YAMLString':
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
