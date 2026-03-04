/**
 * Studyflow Element Templates Core Module
 *
 * Drop-in replacement for CloudElementTemplatesCoreModule.
 * Provides the `elementTemplates` DI service expected by
 * CreateAppendElementTemplatesModule from bpmn-js-create-append-anything.
 *
 * Templates are built from LinkML schema `examples:` metadata
 * rather than static JSON files.
 */

import ElementTemplates from './ElementTemplates';
import SchemaTemplateLoader from './SchemaTemplateLoader';

export const StudyflowElementTemplatesCoreModule = {
  __init__: ['schemaTemplateLoader'],
  elementTemplates: ['type', ElementTemplates],
  schemaTemplateLoader: ['type', SchemaTemplateLoader],
};

export type { ElementTemplate } from './types';
