import { hasRole, type ExportedElement, type ExportModel } from '@modeler/export/model';

type GenericRecord = Record<string, unknown>;

const EEG_DATA_TYPES = new Set(['eeg', 'ieeg']);

function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function isEegRelevant(element: ExportedElement): boolean {
  if (!element.type) return false;
  if (hasRole(element, 'acquisition') || hasRole(element, 'signal') || hasRole(element, 'instrument')) return true;
  return element.isDataElement && EEG_DATA_TYPES.has(String(element.attributes.bidsDataType ?? ''));
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

function toOperationEntry(operation: ExportedElement): GenericRecord {
  return {
    element_id: operation.id,
    label: operation.name,
    operation: operation.attributes.operationType ?? null,
    studyflow_type: operation.type,
    documentation: operation.documentation ?? null,
  };
}

export function exportToArtemis(model: ExportModel): string {
  const diagramName = model.diagramName;

  const acquisition: GenericRecord[] = [];
  const tasks: GenericRecord[] = [];
  const datasets: GenericRecord[] = [];
  const eegElementIds = new Set<string>();

  for (const element of model.elements) {
    if (!isEegRelevant(element)) continue;
    eegElementIds.add(element.id);

    const entry = toEntry(element);
    if (hasRole(element, 'acquisition') && !element.isDataElement) acquisition.push(entry);
    else if (hasRole(element, 'instrument')) tasks.push(entry);
    else datasets.push(entry);
  }

  const preprocessing: GenericRecord[] = [];
  const analysis: GenericRecord[] = [];
  for (const operation of model.operations) {
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
