import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';

import { embedStudyflowIntoPng } from '@core/document';
import { asXml, asYaml, readSource } from '@cli/studyfile';

type TargetFormat = 'yaml' | 'xml' | 'png';

function targetFormat(path: string): TargetFormat {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'png';
  if (ext === '.xml' || ext === '.bpmn') return 'xml';
  if (ext === '.yaml' || ext === '.yml' || ext === '.studyflow') return 'yaml';
  throw new Error(`Cannot tell the target format from "${path}" — use .studyflow/.yaml, .bpmn/.xml, or .studyflow.png.`);
}

export type ConvertOptions = {
  /** For a PNG target: the image to embed into (defaults to the output file itself, or the input if it is a PNG). */
  into?: string;
};

export async function convert(input: string, output: string, options: ConvertOptions): Promise<string> {
  const source = await readSource(input);
  const format = targetFormat(output);

  if (format === 'yaml') {
    await writeFile(output, await asYaml(source), 'utf8');
    return `Wrote ${output} (studyflow YAML).`;
  }

  if (format === 'xml') {
    await writeFile(output, await asXml(source), 'utf8');
    return `Wrote ${output} (BPMN XML).`;
  }

  // PNG: embed the source into an existing image — rendering pixels needs the modeler.
  const basePath = options.into
    ?? (existsSync(output) ? output : source.container === 'png' ? input : undefined);
  if (!basePath) {
    throw new Error(
      'A .studyflow.png target needs an image to embed into: pass --into <png>, or point at an existing PNG. '
      + 'To render a new image, export from the modeler (or `npm run examples:render`).',
    );
  }
  const png = new Uint8Array(await readFile(basePath));
  await writeFile(output, embedStudyflowIntoPng(png, await asXml(source)));
  return `Wrote ${output} (embedded studyflow into ${basePath === output ? 'the existing image' : basePath}).`;
}
