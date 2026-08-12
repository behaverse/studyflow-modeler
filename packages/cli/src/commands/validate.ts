import { SCHEMA_LOAD_FAILURES } from '@core/notation/loader';
import { parseSource, readSource } from '@cli/studyfile';

export type ValidateReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
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

  try {
    const { warnings: readerWarnings } = await parseSource(source);
    warnings.push(...readerWarnings);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return { ok: errors.length === 0, errors, warnings };
}
