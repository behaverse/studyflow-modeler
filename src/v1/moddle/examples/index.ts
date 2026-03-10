/**
 * Studyflow Element Examples Core Module.
 *
 * Provides the `elementTemplates` DI service expected by
 * CreateAppendElementTemplatesModule from bpmn-js-create-append-anything.
 *
 * Examples are built from schema-level `examples:` metadata.
 */

import Examples from './Examples';
import ExampleFlowElementsBehavior from './ExampleFlowElementsBehavior';
import ExamplesLoader from './ExamplesLoader';

export default {
  __init__: ['examplesLoader', 'exampleFlowElementsBehavior'],
  // Keep DI token unchanged for third-party compatibility.
  elementTemplates: ['type', Examples],
  examplesLoader: ['type', ExamplesLoader],
  exampleFlowElementsBehavior: ['type', ExampleFlowElementsBehavior],
};

export type { Example } from './types';
