
import { useContext, useEffect, useState } from 'react';
import { ModelerContext } from '../../contexts';

export default function PropertiesProvider() {

    const modeler = useContext(ModelerContext);
    const injector = modeler.get('injector');
    const eventBus = injector.get('eventBus');
    const [status, setStatus] = useState('idle');

    useEffect(() => {
        console.log('PropertiesProvider2 mounted', eventBus);
        eventBus.on('selection.changed', 1500, (event) => {
            const selections = event.newSelection;
            if (selections.length === 0) {
                setStatus('Nothing selected');
            } else if (selections.length === 1) {
                const element = selections[0].businessObject;
                console.log('element', element);
                setStatus(`Element changed: ${element.id}`);
            } else {
                setStatus('multiple elements selected');
            }

        });
    }, [eventBus]);

    return (
        <div>
            <h1>Properties Provider 2</h1>
            <p>Status: {status}</p>
        </div>
    )

}
