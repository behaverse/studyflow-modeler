import { getAttribute } from '@/core/element';
import { exportDiagramName, forEachBusinessObject } from '@/modeler/export/common';
import {
  collectDataOperations,
  hasRole,
  readExportedElement,
  toSnakeCase,
  type ExportedElement,
  type ExportedOperation,
} from '@/modeler/export/dataElements';
import type { Modeler } from '@/modeler/bpmn/types';

type GenericRecord = Record<string, unknown>;

const EEG_DATA_TYPES = new Set(['eeg', 'ieeg']);

function isEegRelevant(bo: any): boolean {
  if (!bo?.$type) return false;
  if (hasRole(bo, 'acquisition') || hasRole(bo, 'signal') || hasRole(bo, 'instrument')) return true;
  return hasRole(bo, 'data-element')
    && EEG_DATA_TYPES.has(String(getAttribute(bo, 'bidsDataType') ?? ''));
}

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

function toOperationEntry(operation: ExportedOperation): GenericRecord {
  return {
    element_id: operation.id,
    label: operation.name,
    operation: operation.attributes.operationType ?? null,
    studyflow_type: operation.type,
    documentation: operation.documentation ?? null,
  };
}

export function exportToArtemis(modeler: Modeler): string {
  const diagramName = exportDiagramName(modeler);

  const acquisition: GenericRecord[] = [];
  const tasks: GenericRecord[] = [];
  const datasets: GenericRecord[] = [];
  const eegElementIds = new Set<string>();

  forEachBusinessObject(modeler, (bo, el) => {
    if (!isEegRelevant(bo)) return;

    const element = readExportedElement(bo, el?.id);
    eegElementIds.add(element.id);

    const entry = toEntry(element);
    if (hasRole(bo, 'acquisition') && !hasRole(bo, 'data-element')) acquisition.push(entry);
    else if (hasRole(bo, 'instrument')) tasks.push(entry);
    else datasets.push(entry);
  });

  const preprocessing: GenericRecord[] = [];
  const analysis: GenericRecord[] = [];
  for (const operation of collectDataOperations(modeler)) {
    if (eegElementIds.has(operation.id)) continue;
    const touchesEeg = [...operation.inputs, ...operation.outputs].some((id) => eegElementIds.has(id));
    (touchesEeg ? preprocessing : analysis).push(toOperationEntry(operation));
  }

  const foundEegSignal = eegElementIds.size > 0;

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
    preprocessing: preprocessing.length > 0 ? preprocessing : { not_applicable: !foundEegSignal, notes: foundEegSignal ? 'EEG-relevant elements found but no data operation reads or writes one. Fill in the preprocessing steps manually.' : 'No EEG elements in this diagram to preprocess.' },
    analysis: analysis.length > 0 ? analysis : { not_applicable: true, notes: 'No data-operation activities found.' },
    datasets: datasets.length > 0 ? datasets : { not_applicable: true, notes: 'No EEG/timeseries datasets found.' },
  };

  return JSON.stringify(report, null, 2);
}
