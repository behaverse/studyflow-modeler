import { useContext } from 'react';
import { InspectorContext } from '@/modeler/infra/contexts';

/** Element currently shown in the inspector (provided by `Panel`). */
export function useInspectedElement(): any | undefined {
  return useContext(InspectorContext).element;
}
