import * as yaml from 'js-yaml';

export type SchemaColumn = {
  name: string;
  datatype: string;
  description: string;
  required: boolean;
};

export type SchemaFormat = 'csvw' | 'linkml';

export type ParsedSchemaBody = {
  columns: SchemaColumn[];
  format: SchemaFormat;
  unparseable?: boolean;
};

/** The body as data: JSON, or YAML, which is how a `.studyflow.yaml` file folds the JSON the modeler writes. */
function load(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    try {
      return yaml.load(body);
    } catch {
      return undefined;
    }
  }
}

/** The columns a `studyflow:Schema` body declares: CSVW's `tableSchema.columns`, or the attributes of a LinkML body's first class. */
export function parseSchemaBody(body: string): ParsedSchemaBody {
  if (!body || !body.trim()) return { columns: [], format: 'csvw' };
  const doc = load(body);

  const cols = doc?.tableSchema?.columns ?? doc?.columns;
  if (Array.isArray(cols)) {
    return {
      columns: cols.map((c: any) => ({
        name: c?.name ?? '',
        datatype: typeof c?.datatype === 'string' ? c.datatype : c?.datatype?.base ?? 'string',
        description: c?.['dc:description'] ?? c?.description ?? '',
        required: c?.required === true,
      })),
      format: 'csvw',
    };
  }

  const classes = doc?.classes ?? (doc?.attributes ? { Root: doc } : null);
  if (classes && typeof classes === 'object') {
    const attrs = Object.values<any>(classes)[0]?.attributes ?? {};
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

  return { columns: [], format: 'csvw', unparseable: true };
}
