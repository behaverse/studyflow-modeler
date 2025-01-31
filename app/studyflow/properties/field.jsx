import PropTypes from 'prop-types';
import { Field, Description } from '@headlessui/react';
import { TextInput } from './TextInput';
import { MarkdownInput} from './MarkdownInput';
import { BooleanInput } from './BooleanInput';
import { EnumInput } from './EnumInput';

export function PropertyField(props) {
    const { bpmnProperty } = props;
    const propertyType = bpmnProperty.type || 'String';

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
