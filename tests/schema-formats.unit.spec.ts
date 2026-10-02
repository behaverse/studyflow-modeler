import { expect, test } from '@playwright/test';

import { parseSchemaBody, type SchemaColumn } from '@core/document';
import { serialize } from '@modeler/inspector/schemaFormats';

/** The schema editor writes a `studyflow:Schema` body back in the format it read, and core reads its columns from it. */

const COLUMNS: SchemaColumn[] = [
  { name: 'participant_id', datatype: 'string', description: 'Who answered', required: true },
  { name: 'rt', datatype: 'number', description: '', required: false },
];

test("a schema's columns written as CSVW or LinkML read back as the same columns", () => {
  for (const format of ['csvw', 'linkml'] as const) {
    expect(parseSchemaBody(serialize(COLUMNS, format)), format).toEqual({ columns: COLUMNS, format });
  }
});
