import PropTypes from 'prop-types';
import { Field, Description } from '@headlessui/react';
import { TextInput } from './TextInput';
import { MarkdownInput} from './MarkdownInput';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';
import { useEffect, useState, useContext } from 'react';

import { PropertiesPanelContext } from '../../contexts';

export function PropertyField(props) {
    const { bpmnProperty } = props;
    const { element, businessObject } = useContext(PropertiesPanelContext);

    const propertyType = bpmnProperty.type || 'String';
    const [ isVisible, setVisible ] = useState(true);

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
    }, [bpmnProperty, businessObject, element]);

    function renderInput() {
        //TODO use enumerations in the moddle file to determine if it's enum
        switch (propertyType) {
            case 'Boolean':
                return <BooleanInput {...props} />;
            case 'studyflow:InstrumentType':
            case 'studyflow:BehaverseInstrumentType':
            case 'studyflow:Distribution':
                return <EnumInput {...props} />;
            case 'studyflow:MarkdownString':
                return <MarkdownInput {...props} />;
            default:
                return <TextInput {...props} />;
        }
    }

    return (
        <>
        {isVisible &&
            <Field className="mx-2 pb-2">
                {renderInput()}
                <Description className="text-xs/4 text-stone-400">
                    {bpmnProperty?.description}
                </Description>
            </Field>
        }
        </>
    );
}

PropertyField.propTypes = {
    bpmnProperty: PropTypes.node.isRequired
}
