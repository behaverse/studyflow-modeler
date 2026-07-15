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
 * Reference: Styles et al. 2021 (NeuroImage 245:118721); Soskic et al. 2025
 * (Psychophysiology 62(12):e70187).
 */

import { getDiagramName } from '@/modeler/models/diagramName';
import { forEachBusinessObject, readField } from '@/modeler/models/exporters/common';

type GenericRecord = Record<string, unknown>;

function isEegRelevant(bo: any): boolean {
  if (!bo) return false;
  const t = bo.$type as string | undefined;
  if (!t) return false;
  if (t.startsWith('galea:')) return true;
  // Datasets / timeseries with EEG modality.
  if (t === 'studyflow:Dataset' && readField(bo, 'bidsDataType') === 'eeg') return true;
  if (t === 'studyflow:Timeseries') return true;
  // Cognitive tasks count for the task block.
  if (t === 'cognitive:CognitiveTask') return true;
  if (t === 'cognitive:Questionnaire') return true;
  return false;
}

export function exportToArtemis(modeler: any): string {
  const diagramName = getDiagramName(modeler) ?? 'studyflow_export';

  const acquisition: GenericRecord[] = [];
  const preprocessing: GenericRecord[] = [];
  const analysis: GenericRecord[] = [];
  const tasks: GenericRecord[] = [];
  const datasets: GenericRecord[] = [];

  let foundEegSignal = false;

  forEachBusinessObject(modeler, (bo) => {
    const t = bo.$type as string | undefined;
    if (!t) return;

    if (!isEegRelevant(bo)) {
      // Also collect DataOperationActivity entries as analysis-block hints.
      if (readField(bo, 'isDataOperation') === true || readField(bo, 'operation')) {
        analysis.push({
          element_id: bo.id,
          label: bo.name ?? bo.id,
          operation: readField(bo, 'operation') ?? null,
          studyflow_type: t,
          documentation: (readField(bo, 'documentation') as string | undefined) ?? null,
        });
      }
      return;
    }
    foundEegSignal = true;

    if (t === 'galea:GaleaSession' || t === 'galea:GaleaRecording') {
      acquisition.push({
        element_id: bo.id,
        label: bo.name ?? bo.id,
        studyflow_type: t,
        vr_device: readField(bo, 'vrDevice') ?? null,
        stream_protocol: readField(bo, 'streamProtocol') ?? null,
        electrode_type: readField(bo, 'electrodeType') ?? null,
        modalities: readField(bo, 'modalities') ?? null,
        sampling_rate_hz: readField(bo, 'samplingRate') ?? null,
        reference_channel: readField(bo, 'referenceChannel') ?? null,
        ground_channel: readField(bo, 'groundChannel') ?? null,
      });
      return;
    }

    if (t === 'studyflow:Dataset') {
      datasets.push({
        element_id: bo.id,
        label: bo.name ?? bo.id,
        bids_data_type: readField(bo, 'bidsDataType') ?? null,
        format: readField(bo, 'format') ?? null,
        bdm_data_level: readField(bo, 'bdmDataLevel') ?? null,
      });
      return;
    }

    if (t === 'studyflow:Timeseries') {
      datasets.push({
        element_id: bo.id,
        label: bo.name ?? bo.id,
        studyflow_type: t,
        sampling_rate_hz: readField(bo, 'samplingRate') ?? null,
        channel_count: readField(bo, 'channelCount') ?? null,
        units: readField(bo, 'units') ?? null,
        recording_duration_s: readField(bo, 'recordingDuration') ?? null,
        format: readField(bo, 'format') ?? null,
      });
      return;
    }

    if (t === 'cognitive:CognitiveTask' || t === 'cognitive:Questionnaire') {
      tasks.push({
        element_id: bo.id,
        label: bo.name ?? bo.id,
        studyflow_type: t,
        instrument: readField(bo, 'instrument') ?? null,
        configurations: readField(bo, 'configurations') ?? null,
        documentation: (readField(bo, 'documentation') as string | undefined) ?? null,
      });
      return;
    }
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
    acquisition: acquisition.length > 0 ? acquisition : { not_applicable: !foundEegSignal, notes: foundEegSignal ? 'EEG-relevant elements found but no Galea session/recording. Fill in manually.' : 'No EEG acquisition elements in this diagram.' },
    preprocessing: preprocessing.length > 0 ? preprocessing : { not_applicable: !foundEegSignal, notes: 'No PreprocessEEG activities found.' },
    analysis: analysis.length > 0 ? analysis : { not_applicable: true, notes: 'No data-operation activities found.' },
    datasets: datasets.length > 0 ? datasets : { not_applicable: true, notes: 'No EEG/timeseries datasets found.' },
  };

  return JSON.stringify(report, null, 2);
}
