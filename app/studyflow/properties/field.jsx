import PropTypes from 'prop-types';
import { Field, Description } from '@headlessui/react';
import { TextInput } from './TextInput';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';

export function PropertyField(props) {
    const { bpmnProperty } = props;
    const propertyType = bpmnProperty.type || 'String';

    function renderInput() {
        switch (propertyType) {
            case 'Boolean':
                return <BooleanInput {...props} />;
            case 'studyflow:InstrumentType':
            case 'studyflow:BehaverseInstrumentType':
                return <EnumInput {...props} />;
            default:
                return <TextInput {...props} />;
        }
    }

    return (
            <Field className="mx-2 pb-2">
                {renderInput()}
                <Description className="text-xs/4 text-stone-400">
                    {bpmnProperty?.description}
                </Description>
            </Field>
    );
}

PropertyField.propTypes = {
    element: PropTypes.node.isRequired,
    bpmnProperty: PropTypes.node.isRequired
}
