/**
 * ARTEM-IS exporter: Agreed Reporting Template for EEG Methodology International Standard.
 *
 * Walks the diagram for EEG-relevant elements and emits a JSON skeleton with
 * the sections ARTEM-IS reports expect (general / participants / task /
 * acquisition / preprocessing / analysis). Fields that the diagram cannot
 * supply output as `null` so they can be filled manually.
 * A diagram with no EEG elements produces a partial skeleton marked
 * `not_applicable: true` instead of throwing.
 *
 *  The data model used here is just a subset.
 *
 * Which elements land in which block is the schemas' call, not this file's:
 * a block collects the types declaring a role (`acquisition`, `instrument`,
 * `signal`/`data-element`), and each entry carries whatever attributes those
 * types declare. Adding a board or an instrument to a schema fills the report
 * without touching this exporter.
 *
 * Reference: Styles et al. 2021 (NeuroImage 245:118721); Soskic et al. 2025
 * (Psychophysiology 62(12):e70187).
 */

import { getDiagramName } from '@/modeler/models/diagramName';
import { isDataOperationActivity } from '@/core/extensions';
import { forEachBusinessObject, readField } from '@/modeler/models/exporters/common';
import {
  hasRole,
  readExportedElement,
  toSnakeCase,
  type ExportedElement,
} from '@/modeler/models/exporters/dataElements';

type GenericRecord = Record<string, unknown>;

/** BIDS data type marking a dataset as EEG, whatever type declares it. */
const EEG_DATA_TYPES = new Set(['eeg', 'ieeg']);

/**
 * EEG-relevant elements: anything acquiring a signal, any element holding one,
 * a participant-facing instrument, and any data element whose BIDS data type
 * says EEG. The last is a value on the instance, so it stays a value check.
 */
function isEegRelevant(bo: any): boolean {
  if (!bo?.$type) return false;
  if (hasRole(bo, 'acquisition') || hasRole(bo, 'signal') || hasRole(bo, 'instrument')) return true;
  return hasRole(bo, 'data-element')
    && EEG_DATA_TYPES.has(String(readField(bo, 'bidsDataType') ?? ''));
}

/** One report entry: identity plus every attribute the element's type declares. */
function toEntry(bo: ExportedElement): GenericRecord {
  const entry: GenericRecord = {
    element_id: bo.id,
    label: bo.name,
    studyflow_type: bo.type,
  };
  for (const [name, value] of Object.entries(bo.attributes)) {
    entry[toSnakeCase(name)] = value;
  }
  if (bo.documentation) entry.documentation = bo.documentation;
  return entry;
}

export function exportToArtemis(modeler: any): string {
  const diagramName = getDiagramName(modeler) ?? 'studyflow_export';

  const acquisition: GenericRecord[] = [];
  const preprocessing: GenericRecord[] = [];
  const analysis: GenericRecord[] = [];
  const tasks: GenericRecord[] = [];
  const datasets: GenericRecord[] = [];

  let foundEegSignal = false;

  forEachBusinessObject(modeler, (bo, el) => {
    if (!bo?.$type) return;

    if (!isEegRelevant(bo)) {
      // Derived data-operation entries are analysis-block hints.
      if (isDataOperationActivity(bo)) {
        analysis.push({
          element_id: bo.id,
          label: bo.name ?? bo.id,
          operation: readField(bo, 'operationType') ?? null,
          studyflow_type: bo.$type,
          documentation: (readField(bo, 'documentation') as string | undefined) ?? null,
        });
      }
      return;
    }
    foundEegSignal = true;

    const entry = toEntry(readExportedElement(bo, el?.id));
    if (hasRole(bo, 'acquisition') && !hasRole(bo, 'data-element')) acquisition.push(entry);
    else if (hasRole(bo, 'instrument')) tasks.push(entry);
    else datasets.push(entry);
  });

  const report: GenericRecord = {
    $schema: 'https://behaverse.org/schemas/artemis-export.v0.json',
    artemis_version: '2025-erp',
    studyflow_source: {
      diagram_name: diagramName,
      generated_at: new Date().toISOString(),
      notes: 'Auto-extracted from a Studyflow diagram. Fields marked null require human completion.',
    },
    general: {
      study_title: diagramName,
      authors: null,
      preregistration_url: null,
      ethics_approval: null,
    },
    participants: {
      sample_size: null,
      inclusion_criteria: null,
      exclusion_criteria: null,
      compensation: null,
    },
    task: tasks.length > 0 ? tasks : { not_applicable: true, notes: 'No cognitive task or questionnaire elements found.' },
    acquisition: acquisition.length > 0 ? acquisition : { not_applicable: !foundEegSignal, notes: foundEegSignal ? 'EEG-relevant elements found but no acquisition session/recording. Fill in manually.' : 'No EEG acquisition elements in this diagram.' },
    preprocessing: preprocessing.length > 0 ? preprocessing : { not_applicable: !foundEegSignal, notes: 'No PreprocessEEG activities found.' },
    analysis: analysis.length > 0 ? analysis : { not_applicable: true, notes: 'No data-operation activities found.' },
    datasets: datasets.length > 0 ? datasets : { not_applicable: true, notes: 'No EEG/timeseries datasets found.' },
  };

  return JSON.stringify(report, null, 2);
}
