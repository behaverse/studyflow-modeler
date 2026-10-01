import { SCHEMA_LOAD_FAILURES, SKILLS } from '@core/notation/loader';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { checkImplementations } from '@core/checks/implementations';
import { checkRecorded } from '@core/checks/recorded';
import { installedSkills } from '@cli/skills';
import { planChecks, recordChecks } from '@core/checks';
import { checkSoundness } from '@core/checks/soundness';
import { asXml, parseSource, readSource } from '@cli/studyfile';
import { xsdViolations } from '@cli/xsd';

export type ValidateReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** What the OK line adds: that the protocol is still the one a run recorded. */
  note?: string;
};

export async function validate(input: string): Promise<ValidateReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let source;
  try {
    source = await readSource(input);
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)], warnings };
  }

  for (const failure of SCHEMA_LOAD_FAILURES) {
    warnings.push(`schema ${failure.sourceName} failed to load: ${failure.message}`);
  }

  let note: string | undefined;
  try {
    const { definitions, warnings: readerWarnings } = await parseSource(source);
    warnings.push(...readerWarnings);
    // The plan checks, then what a run left in the file (nothing to check in a file no run has stamped).
    const record = await recordChecks(definitions);
    // An executed copy in its run repository has the run's record beside it: what the file keeps is read off it.
    const journal = path.join(path.dirname(input), 'events.jsonl');
    const events = existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line)) : [];
    const recorded = events.length > 0 ? checkRecorded(definitions, events) : [];
    for (const { severity, message } of [...planChecks(definitions), ...checkImplementations(definitions, new Set([...SKILLS, ...installedSkills().map((skill) => skill.manifest)].flatMap((skill) => skill.schemes ?? []))), ...record.issues, ...recorded]) {
      (severity === 'error' ? errors : warnings).push(message);
    }
    // Every way the study can go, explored, once the plan checks pass.
    const soundness = errors.length === 0 ? await checkSoundness(definitions) : { issues: [] };
    for (const { message } of soundness.issues) warnings.push(message);
    const recordNote = record.note && events.length > 0 && recorded.length === 0 ? `${record.note}; its state is its record's` : record.note;
    note = [soundness.note, recordNote].filter(Boolean).join(', ') || undefined;
    // The BPMN XML the study is written as, against the OMG's schema: what another BPMN tool reads.
    const violations = xsdViolations(await asXml(source));
    if (violations === undefined) warnings.push('the BPMN XML was not checked against the BPMN 2.0 schema: this machine has no xmllint');
    for (const violation of violations ?? []) errors.push(`the BPMN XML breaks the BPMN 2.0 schema at ${violation}`);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { ok: errors.length === 0, errors, warnings, note };
}
