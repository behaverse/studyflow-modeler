import PropTypes from 'prop-types';
import { Field } from '@headlessui/react';
import { StringInput } from './StringInput';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';
import { useEffect, useState, useContext } from 'react';

import { PropertiesPanelContext } from '../contexts';

export function PropertyField(props) {
    const { bpmnProperty } = props;
    const { element, businessObject } = useContext(PropertiesPanelContext);

    const propertyType = bpmnProperty.type || 'String';
    const [isVisible, setVisible] = useState(true);

    // conditional visibility
    useEffect(() => {
        if (bpmnProperty['superClass']?.includes("bpmn:ComplexBehaviorDefinition")) {
            const conditions = bpmnProperty["condition"]?.body || {};
            const results = Object.entries(conditions).map(([cKey, cExpectedVal]) => {
                // TODO make sure the language of conditions is set to "json"
                const cVal = businessObject.get(cKey);
                return cVal === cExpectedVal;
            });
            // visible if all conditions are met
            setVisible(results.every((r) => r));
        }
        return () => {
            setVisible(true);
        }
    }, [bpmnProperty, businessObject, element]);

    // TODO check if this field is a condition for another field

    function renderInput() {
        //TODO use enumerations in the moddle file to determine if it's enum
        switch (propertyType) {
            case 'Boolean':
                return <BooleanInput {...props} />;
            case 'studyflow:InstrumentEnum':
            case 'studyflow:BehaverseTaskEnum':
            case 'studyflow:Distribution':
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
