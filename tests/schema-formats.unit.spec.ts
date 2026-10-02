import { expect, test } from '@playwright/test';

import { parseSchemaBody, type SchemaColumn } from '@core/document';
import { editedFormat, serialize } from '@modeler/inspector/schemaFormats';

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

test("the column editor edits a schema in the format its `format` names, else its body's, and leaves the rest to text", () => {
  const csvw = serialize(COLUMNS, 'csvw');
  const linkml = serialize(COLUMNS, 'linkml');
  const rows: [unknown, string, string | undefined][] = [
    [undefined, '', 'csvw'],
    [undefined, linkml, 'linkml'],
    ['linkml', csvw, 'linkml'],
    ['csvw', linkml, 'csvw'],
    ['jsonschema', '', undefined],
    ['frictionless', csvw, undefined],
    ['csvw', 'schemas/trials.json', undefined],
  ];
  for (const [format, body, edited] of rows) {
    expect(editedFormat(format, body), `${String(format)}: ${body.slice(0, 20)}`).toBe(edited);
  }
});
