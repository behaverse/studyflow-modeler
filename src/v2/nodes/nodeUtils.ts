/**
 * Shared utilities for v2 node components.
 */
import {
  getAppliedStudyflowType,
  getExtensionElement,
  getNamespacedAttrValue,
  getProperty,
} from '../../shared/extensionElements';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS } from './constants';

/** Resolve the icon class for a BPMN element. */
export function resolveIconClass(
  businessObject: any,
  typeMap: Record<string, any>,
  enumerations?: any[],
  preservePrimary = false,
): string | undefined {
  const ext = getExtensionElement(businessObject);
  const sfType = getAppliedStudyflowType(businessObject);
  const sfDescriptor = sfType ? typeMap[sfType] : undefined;

  // Icon from extension element attribute (e.g., example override)
  const prefix = ext?.$type?.split(':')?.[0];
  const exampleIcon = getNamespacedAttrValue(
    ext || businessObject,
    'icon',
    prefix,
  );

  // Icon from schema descriptor metadata
  const descriptorIcon = sfDescriptor?.meta?.icon || sfDescriptor?.icon;

  let iconClass = exampleIcon || descriptorIcon || BPMN_ICON_OVERRIDES[businessObject?.$type] || undefined;

  // For activities with extension elements, resolve instrument-based icon
  if (ext && enumerations && !preservePrimary && !exampleIcon) {
    const instrument = getProperty(businessObject, 'instrument');
    const instrumentEnum = enumerations.find((e: any) => e.name === 'InstrumentEnum');
    const instrumentIcon = instrumentEnum?.literalValues?.find(
      (lv: any) => lv.value === instrument,
    )?.icon;
    if (instrumentIcon) {
      iconClass = instrumentIcon;
    }
  }

  return iconClass;
}

/** Resolve the scene text for behaverse instrument activities. */
export function resolveSceneText(
  businessObject: any,
  preservePrimary = false,
): string | undefined {
  if (preservePrimary) return undefined;
  const ext = getExtensionElement(businessObject);
  if (!ext) return undefined;

  const instrument = getProperty(businessObject, 'instrument');
  if (instrument !== 'behaverse') return undefined;

  const scene = getProperty(businessObject, 'scene')?.toUpperCase();
  return scene === 'UNDEFINED' ? undefined : scene;
}

/** Resolve the format icon for data store elements. */
export function resolveDataStoreIcon(
  businessObject: any,
  enumerations: any[],
): string | undefined {
  const format = getProperty(businessObject, 'format');
  const formatEnum = enumerations.find((e: any) => e.name === 'DatasetFormatEnum');
  return formatEnum?.literalValues?.find((lv: any) => lv.value === format)?.icon || undefined;
}

/** Compute the list of marker keys for an activity element. */
export function resolveMarkers(businessObject: any): string[] {
  const markers: string[] = [];

  if (getProperty(businessObject, 'isDataOperation')) {
    markers.push('operation');
  }

  const checklist = getProperty(businessObject, 'checklist');
  if (checklist?.length > 0) {
    markers.push('checklist');
  }

  if (businessObject.$type === 'bpmn:SubProcess') {
    markers.push('subprocess');
  }

  if (businessObject.$type === 'bpmn:AdHocSubProcess') {
    markers.push('adhoc');
  }

  if (getProperty(businessObject, 'isForCompensation')) {
    markers.push('compensation');
  }

  const loopCharacteristics = getProperty(businessObject, 'loopCharacteristics');
  if (loopCharacteristics) {
    const isSequential = loopCharacteristics.get?.('isSequential') ?? loopCharacteristics.isSequential;
    if (isSequential === true) markers.push('sequential');
    else if (isSequential === false) markers.push('parallel');
    else markers.push('loop');
  }

  return markers;
}

/** Get the icon class for a marker key. */
export function getMarkerIcon(marker: string): string | undefined {
  return MARKER_ICONS[marker];
}

/** Check if a string is an image URL. */
export function isImageUrl(icon?: string): boolean {
  return Boolean(icon && /^(https?:\/\/|data:image\/)/i.test(icon));
}
