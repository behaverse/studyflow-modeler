import { SCHEMA_LOAD_FAILURES } from '@core/notation/loader';
import { planChecks, recordChecks } from '@core/checks';
import { parseSource, readSource } from '@cli/studyfile';

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
    for (const { severity, message } of [...planChecks(definitions), ...record.issues]) {
      (severity === 'error' ? errors : warnings).push(message);
    }
    note = record.note;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { ok: errors.length === 0, errors, warnings, note };
}
