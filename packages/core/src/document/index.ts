/*
 * A study's files: BPMN XML in and out of the study model (`bpmn.ts`, the one place moddle is used), a study
 * embedded in a picture (`png.ts`, `svg.ts`), its protocol digest, and the text formats some attributes hold.
 * Outside `core/document`, only this barrel, `png.ts`, `svg.ts`, `digest.ts`, `schema-body.ts` and `outline.ts` are
 * imported.
 */
export { looksLikeXml, parseStudy, studyToXml, xmlToStudy } from '@core/document/bpmn';
export { protocolDigest } from '@core/document/digest';
export {
  checklistItems,
  parseChecklistLines,
  serializeChecklistLines,
  type ChecklistItem,
  type ChecklistLine,
} from '@core/document/checklist';
export {
  parseSchemaBody,
  type ParsedSchemaBody,
  type SchemaColumn,
  type SchemaFormat,
} from '@core/document/schema-body';
export {
  dataUrlToBytes,
  embedStudyflowIntoPng,
  extractStudyflowFromPng,
} from '@core/document/png';
export { extractStudyflowFromSvg, replaceStudyflowInSvg } from '@core/document/svg';
