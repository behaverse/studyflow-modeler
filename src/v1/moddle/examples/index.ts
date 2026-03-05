/**
 * Studyflow Element Examples Core Module.
 *
 * Provides the `elementTemplates` DI service expected by
 * CreateAppendElementTemplatesModule from bpmn-js-create-append-anything.
 *
 * Examples are built from LinkML schema `examples:` metadata.
 */

import Examples from './Examples';
import ExamplesLoader from './ExamplesLoader';

export default {
  __init__: ['examplesLoader'],
  // Keep DI token unchanged for third-party compatibility.
  elementTemplates: ['type', Examples],
  examplesLoader: ['type', ExamplesLoader],
};

export type { Example } from './types';
