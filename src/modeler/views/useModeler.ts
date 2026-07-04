import { useContext } from 'react';
import { ModelerContext } from '@/modeler/infra/contexts';

/** Read-only access to the bpmn-js modeler instance. */
export function useModeler(): any {
  return useContext(ModelerContext).modeler;
}
