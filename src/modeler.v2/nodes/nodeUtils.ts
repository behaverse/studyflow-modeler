/**
 * Shared utilities for v2 node components.
 */
import { is } from 'bpmn-js/lib/util/ModelUtil';
import {
  getAppliedStudyflowType,
  getExtensionElement,
  getNamespacedAttrValue,
  getProperty,
} from '../../shared/extensionElements';
import { BPMN_ICON_OVERRIDES, MARKER_ICONS } from './constants';

const DATA_OP_ICON = 'iconify mdi--function';

/**
 * Service/Script tasks marked as data operations promote the function symbol
 * from a marker into the primary activity icon — but only when no specific
 * icon was supplied (e.g. Preprocess_fMRI keeps its brain icon and falls
 * back to the operation marker).
 */
function isDataOpPromotedToIcon(businessObject: any, explicitIcon?: string): boolean {
  if (!getProperty(businessObject, 'isDataOperation')) return false;
  if (explicitIcon) return false;
  return is(businessObject, 'bpmn:ServiceTask') || is(businessObject, 'bpmn:ScriptTask');
}

function getExplicitIcon(businessObject: any, typeMap?: Record<string, any>): string | undefined {
  const ext = getExtensionElement(businessObject);
  const sfType = getAppliedStudyflowType(businessObject);
  const sfDescriptor = sfType && typeMap ? typeMap[sfType] : undefined;
  const prefix = ext?.$type?.split(':')?.[0];
  const exampleIcon = getNamespacedAttrValue(ext || businessObject, 'icon', prefix);
  const descriptorIcon = sfDescriptor?.meta?.icon || sfDescriptor?.icon;
  return exampleIcon || descriptorIcon;
}

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
  const explicitIcon = exampleIcon || descriptorIcon;

  if (isDataOpPromotedToIcon(businessObject, explicitIcon)) {
    return DATA_OP_ICON;
  }

  let iconClass = explicitIcon || BPMN_ICON_OVERRIDES[businessObject?.$type] || undefined;

  // Resolve instrument-based icon for any activity that exposes instrument.
  if (enumerations && !preservePrimary && !exampleIcon) {
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
export function resolveMarkers(businessObject: any, typeMap?: Record<string, any>): string[] {
  const markers: string[] = [];

  if (getProperty(businessObject, 'isDataOperation')) {
    // Skip the marker on Service/Script tasks without a custom icon — the
    // icon itself shows the function symbol there.
    const explicitIcon = getExplicitIcon(businessObject, typeMap);
    if (!isDataOpPromotedToIcon(businessObject, explicitIcon)) {
      markers.push('operation');
    }
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
