import * as yaml from 'js-yaml';

/**
 * Column-list codec for tabular schema bodies: parses CSVW JSON-LD or LinkML
 * YAML into a flat column list and serializes back to the source format. Pure
 * text transforms — the editing UI lives in `SchemaEditor.tsx`.
 */

export type Column = {
  name: string;
  datatype: string;
  description: string;
  required: boolean;
};

export type SourceFormat = 'csvw' | 'linkml';

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

/** Best-effort parse of CSVW JSON-LD or LinkML YAML into a column list. */
export function parseBody(body: string): { columns: Column[]; format: SourceFormat } {
  if (!body || !body.trim()) return { columns: [], format: 'csvw' };

  // Try JSON-LD first.
  try {
    const json = JSON.parse(body);
    const cols = json.tableSchema?.columns ?? json.columns ?? [];
    if (Array.isArray(cols)) {
      return {
        columns: cols.map((c: any) => ({
          name: c.name ?? '',
          datatype: typeof c.datatype === 'string' ? c.datatype : c.datatype?.base ?? 'string',
          description: c['dc:description'] ?? c.description ?? '',
          required: c.required === true,
        })),
        format: 'csvw',
      };
    }
  } catch {
    // Not JSON; fall through to YAML.
  }

  // Try LinkML YAML.
  try {
    const doc: any = yaml.load(body);
    if (doc && typeof doc === 'object') {
      // Single class with attributes, or a `classes:` block where each class has attributes.
      const classes = doc.classes ?? (doc.attributes ? { Root: doc } : null);
      if (classes) {
        const firstClassName = Object.keys(classes)[0];
        const cls = classes[firstClassName];
        const attrs = cls?.attributes ?? {};
        return {
          columns: Object.entries(attrs).map(([name, def]: [string, any]) => ({
            name,
            datatype: def?.range ?? 'string',
            description: def?.description ?? '',
            required: def?.required === true,
          })),
          format: 'linkml',
        };
      }
    }
  } catch {
    // Not parseable; return empty.
  }

  return { columns: [], format: 'csvw' };
}

function serializeCsvw(columns: Column[]): string {
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

function serializeLinkml(columns: Column[]): string {
  const attrs: Record<string, any> = {};
  for (const c of columns) {
    const def: Record<string, unknown> = { range: c.datatype || 'string' };
    if (c.description) def.description = c.description;
    if (c.required) def.required = true;
    attrs[c.name || `column_${Object.keys(attrs).length}`] = def;
  }
  return yaml.dump({ classes: { TableRow: { attributes: attrs } } }, { lineWidth: 100 });
}

export function serialize(columns: Column[], format: SourceFormat): string {
  return format === 'linkml' ? serializeLinkml(columns) : serializeCsvw(columns);
}
