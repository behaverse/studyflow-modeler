import PropTypes, { element } from 'prop-types';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { PropertyField } from './field';


export function PropertiesGroup(props) {
    const { element, name, bpmnProperties } = props;

    if (bpmnProperties.length === 0) {
        return <></>;
    }

    return (
        <Disclosure>
            <DisclosureButton
                className="group p-1 text-left w-full text-md font-semibold text-stone-700"
            >
                {name}
                <i className="bi bi-chevron-down float-end group-data-[open]:rotate-180"></i>
            </DisclosureButton>
            <DisclosurePanel transition
                className="p-1 origin-top transition duration-200 ease-out data-[closed]:-translate-y-6 data-[closed]:opacity-0"
            >
            {bpmnProperties.map((p) => (
                <PropertyField key={`${element.id} + ${p.ns.name}`} element={element} bpmnProperty={p} />
            ))}
            </DisclosurePanel>
        </Disclosure>

    );
}

PropertiesGroup.propTypes = {
    element: PropTypes.node.isRequired,
    name: PropTypes.string.isRequired,
    bpmnProperties: PropTypes.array.isRequired
}
