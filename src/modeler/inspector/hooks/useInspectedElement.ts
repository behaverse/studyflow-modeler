import { useContext } from 'react';
import { InspectorContext } from '../../contexts';

/** Element currently shown in the inspector (provided by `Panel`). */
export function useInspectedElement(): any | undefined {
  return useContext(InspectorContext).element;
}
