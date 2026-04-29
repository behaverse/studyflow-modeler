import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { resolveBpmnCreateType } from '../moddle/resolveBpmnType';
import { splitQName } from '../utils/naming';
import { APPLIED_TYPE_ATTR, getAttr, isExtensionPrefix } from './attrs';
import { getExtensionElement, isExtendsType } from './wrapper';
import { getProperty } from './resolve';

const IGNORED_INFERENCE_DEFAULTS = new Set(['id', 'name', 'documentation']);

function getCandidateInferenceDefaults(descriptor: any): Record<string, any> {
  const defaults: Record<string, any> = {};

  for (const property of descriptor?.properties ?? []) {
    if (
      property?.default !== undefined
      && !IGNORED_INFERENCE_DEFAULTS.has(property.name)
    ) {
      defaults[property.name] = property.default;
    }
  }

  return defaults;
}

function valuesMatch(left: any, right: any): boolean {
  if (left === right) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return false;
}

function inferAppliedType(elementOrBusinessObject: any): string | undefined {
  const businessObject = getBusinessObject(elementOrBusinessObject);
  const model = businessObject?.$model;
  const typeMap: Record<string, any> = model?.registry?.typeMap ?? {};
  const bpmnType = businessObject?.$type;

  if (!businessObject || !model || !bpmnType) return undefined;

  let bestMatch: { typeName: string; score: number } | undefined;

  for (const [typeName, descriptor] of Object.entries(typeMap)) {
    if (!typeName.includes(':')) continue;

    const prefix = descriptor?.ns?.prefix ?? splitQName(typeName).prefix;
    if (!isExtensionPrefix(prefix) || descriptor?.isAbstract) continue;

    if (!isExtendsType(typeName, model)) continue;

    if (resolveBpmnCreateType(model, descriptor) !== bpmnType) continue;

    const defaults = getCandidateInferenceDefaults(descriptor);
    const entries = Object.entries(defaults);
    if (entries.length === 0) continue;

    const matchesAllDefaults = entries.every(([propertyName, defaultValue]) => {
      const currentValue = getProperty(businessObject, propertyName);
      return valuesMatch(currentValue, defaultValue);
    });

    if (!matchesAllDefaults) continue;

    const score = entries.length;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { typeName, score };
    }
  }

  return bestMatch?.typeName;
}

export function getAppliedType(elementOrBusinessObject: any): string | undefined {
  const extensionElement = getExtensionElement(elementOrBusinessObject);
  if (extensionElement?.$type) return extensionElement.$type;

  const businessObject = getBusinessObject(elementOrBusinessObject);
  const appliedType = getAttr(businessObject, APPLIED_TYPE_ATTR);
  if (appliedType) return appliedType;

  return inferAppliedType(businessObject);
}

export { inferAppliedType };
