import { useEffect, useState, useContext } from 'react';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import 'bpmn-js-color-picker/colors/color-picker.css';
import { ModelerContext } from './contexts';
import { executeCommand } from '@/v1/commands';

export function Modeler() {

    const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
    const { setModeler } = useContext(ModelerContext);
    const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    executeCommand(null, {
      type: 'download-schemas',
    })
      .then((schemas: Record<string, any>) => executeCommand(null, {
        type: 'create-modeler',
        container: canvas,
        extensionSchemas: schemas,
      }))
      .then((modeler: any) => {
        setModeler(modeler);
        setLoading(false);
      })
      .catch((err: any) => console.log('Error creating modeler:', err));

    return () => {
      // modeler.destroy();
    }
  }, [canvas, setModeler]);

  if (isLoading) {
    return (
      <div className="flex h-full text-center">
        <div role="status" className="m-auto animate-spin">
          <span className="bi bi-arrow-repeat text-fuchsia-600 text-[3rem]"></span>
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }
  
    return (
        <div className="grow bg-amber-50" ref={setCanvas}></div>
    );
}
