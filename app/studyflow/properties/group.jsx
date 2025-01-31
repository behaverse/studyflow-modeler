import PropTypes from 'prop-types';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { PropertyField } from './field';

import { useContext } from 'react';
import { PropertiesPanelContext } from '../../contexts';

import { t } from '../../i18n';


export function PropertiesGroup(props) {
    const { name, bpmnProperties } = props;
    const { businessObject } = useContext(PropertiesPanelContext);

    if (bpmnProperties.length === 0) {
        return <></>;
    }

    return (
        <Disclosure defaultOpen={name==="general"}>
                <DisclosureButton
                    className="group p-2 text-left w-full text-md font-semibold text-stone-700"
                >
                    {t(name)}
                    <i className="bi bi-chevron-down group-data-[open]:rotate-180 float-end"></i>
                    </DisclosureButton>
                <DisclosurePanel transition
                    className="p-1 origin-top transition duration-200 ease-out data-[closed]:-translate-y-6 data-[closed]:opacity-0"
                >
                    {bpmnProperties.map((p) => (
                        <PropertyField
                            key={`${businessObject.id}${p.ns.name}`}
                            bpmnProperty={p} />
                    ))}
                </DisclosurePanel>
        </Disclosure>

    );
}

PropertiesGroup.propTypes = {
    name: PropTypes.string.isRequired,
    bpmnProperties: PropTypes.array.isRequired
}
