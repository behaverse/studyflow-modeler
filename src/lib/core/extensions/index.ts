export { CORE_PREFIXES, isExtensionPrefix, getAttr, setAttr } from './attrs';
export {
  getExtensionElement,
  getExtensionElementProperties,
  createExtensionElement,
  hasExtends,
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
export { getExtensionType } from './extensionType';
export { getDefaults } from './defaults';
