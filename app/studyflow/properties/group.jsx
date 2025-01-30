import PropTypes from 'prop-types';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { PropertyField } from './field';

import { t } from '../../i18n';


export function PropertiesGroup(props) {
    const { element, name, bpmnProperties } = props;

    if (bpmnProperties.length === 0) {
        return <></>;
    }

    return (
        <Disclosure defaultOpen={name==="general"}>
        {({ open }) => (
            <>
                <DisclosureButton
                    className="p-2 text-left w-full text-md font-semibold text-stone-700"
                >
                    {t(name)}
                    {open ? (
                        <i className="bi bi-chevron-up float-end"></i>
                    ) : (<i className="bi bi-chevron-down float-end"></i>)}
                </DisclosureButton>
                <DisclosurePanel transition
                    className="p-1 origin-top transition duration-200 ease-out data-[closed]:-translate-y-6 data-[closed]:opacity-0"
                >
                    {bpmnProperties.map((p) => (
                        <PropertyField key={`${element.id} + ${p.ns.name}`} element={element} bpmnProperty={p} />
                    ))}
                </DisclosurePanel>
            </>
        )}
        </Disclosure>

    );
}

PropertiesGroup.propTypes = {
    element: PropTypes.node.isRequired,
    name: PropTypes.string.isRequired,
    bpmnProperties: PropTypes.array.isRequired
}
