export { CORE_PREFIXES, isExtensionPrefix, getAttr, setAttr, setAppliedType, APPLIED_TYPE_ATTR } from './attrs';
export {
  getExtensionElement,
  getExtensionElementProperties,
  createExtensionElement,
  hasExtends,
  isExtendsType,
} from './wrapper';
export {
  findPropertyDescriptor,
  getEffectiveDescriptorProperties,
  getEffectivePropertyDescriptor,
  getBusinessObjectPropertyDescriptor,
  getExtensionPropertyDescriptor,
  getElementProperties,
  getRedefinedPropertyName,
} from './descriptors';
export {
  resolveContext,
  resolveProperty,
  getProperty,
  setProperty,
  type ResolvedContext,
  type ResolvedProperty,
} from './resolve';
export { getAppliedType, inferAppliedType } from './appliedType';
export { getDefaults } from './defaults';
