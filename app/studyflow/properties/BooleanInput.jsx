import PropTypes from 'prop-types';
import { Checkbox, Label, Field } from '@headlessui/react';
import { useContext, useState } from 'react';
import { ModelerContext } from '../../contexts';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { t } from '../../i18n';


export function BooleanInput(props) {
    const { element, bpmnProperty } = props;
    const name = bpmnProperty.ns.name;
    const [value, setValue] = useState(getBusinessObject(element).get(name) || false);

    const modeling = useContext(ModelerContext).get('injector').get('modeling');

    function handleChange(checked) {
        setValue(checked);
        modeling.updateProperties(element, {
            [name]: checked
        });
    }
    

    return (
        <div className="flex items-center gap-2">
        <Checkbox
        checked={value}
        onChange={handleChange}
        className="group block size-4 rounded border bg-white data-[checked]:bg-blue-500"
        >
      {/* Checkmark icon */}
      <svg className="stroke-white opacity-0 group-data-[checked]:opacity-100" viewBox="0 0 14 14" fill="none">
        <path d="M3 8L6 11L11 3.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
        </Checkbox>
            <Label>{t(name)}</Label>
        </div>
    );
}

BooleanInput.propTypes = {
    element: PropTypes.node.isRequired,
    bpmnProperty: PropTypes.node.isRequired,
}
