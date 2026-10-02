import * as yaml from 'js-yaml';

import { parseSchemaBody, type SchemaColumn, type SchemaFormat } from '@core/document';

/* The schema editor's writer, the inverse of core's `parseSchemaBody`: columns back to a CSVW or a LinkML body. */

export const DATATYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'dateTime',
  'duration',
  'anyURI',
];

/**
 * The format the column editor edits a schema in: the one its `format` attribute names, else the one its body is
 * written in. None when the table cannot hold the schema, a format other than CSVW and LinkML or a body it cannot read
 * as either (a path, a URL): that schema is edited as text.
 */
export function editedFormat(format: unknown, body: string): SchemaFormat | undefined {
  const parsed = parseSchemaBody(body);
  if (parsed.unparseable) return undefined;
  if (format === undefined) return parsed.format;
  return format === 'csvw' || format === 'linkml' ? format : undefined;
}

function serializeCsvw(columns: SchemaColumn[]): string {
  const doc = {
    '@context': 'http://www.w3.org/ns/csvw',
    tableSchema: {
      columns: columns.map((c) => {
        const out: Record<string, unknown> = { name: c.name, datatype: c.datatype };
        if (c.description) out['dc:description'] = c.description;
        if (c.required) out.required = true;
        return out;
      }),
    },
  };
  return JSON.stringify(doc, null, 2);
}

function serializeLinkml(columns: SchemaColumn[]): string {
  const attrs: Record<string, any> = {};
  for (const c of columns) {
    const def: Record<string, unknown> = { range: c.datatype || 'string' };
    if (c.description) def.description = c.description;
    if (c.required) def.required = true;
    attrs[c.name || `column_${Object.keys(attrs).length}`] = def;
  }
  return yaml.dump({ classes: { TableRow: { attributes: attrs } } }, { lineWidth: 100 });
}

export function serialize(columns: SchemaColumn[], format: SchemaFormat): string {
  return format === 'linkml' ? serializeLinkml(columns) : serializeCsvw(columns);
}
