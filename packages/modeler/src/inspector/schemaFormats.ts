import * as yaml from 'js-yaml';

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

export type ParsedBody = {
  columns: Column[];
  format: SourceFormat;
  unparseable?: boolean;
};

export function parseBody(body: string): ParsedBody {
  if (!body || !body.trim()) return { columns: [], format: 'csvw' };

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
  }

  try {
    const doc: any = yaml.load(body);
    if (doc && typeof doc === 'object') {
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
  }

  if (body.trim()) return { columns: [], format: 'csvw', unparseable: true };

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
