/**
 * Dev harness for the P1 read-only renderer (design §6). Mounts a {@link Canvas},
 * lets a developer pick one of the shipped `.studyflow.png` examples, extracts its
 * embedded BPMN XML, parses it with `bpmn-moddle`, and renders the scene. No React,
 * no Tailwind — this is a human-facing smoke tool, not part of the package surface.
 *
 * The automated golden-SVG assertions live in `tests/canvas-render.unit.spec.ts`.
 */

import { BpmnModdle } from 'bpmn-moddle';

import { extractXmlFromPng } from '@core/document/png.ts';
import { loadAllSchemas } from '@core/notation/loader.ts';

import { Canvas } from '@canvas/index.ts';

// Every shipped example PNG, as a URL Vite can fetch. `#assets` is aliased in vite.config.ts.
const exampleUrls = import.meta.glob('#assets/schemas/examples/*/*.studyflow.png', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const picker = document.getElementById('picker') as HTMLSelectElement;
const stage = document.getElementById('stage') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

/** name → fetch URL, sorted by display name. */
const examples = Object.entries(exampleUrls)
  .map(([path, url]) => ({ name: path.split('/').pop() ?? path, url }))
  .sort((a, b) => a.name.localeCompare(b.name));

let moddlePackages: Record<string, unknown> = {};

async function render(name: string, url: string): Promise<void> {
  setStatus(`rendering ${name}…`);
  stage.replaceChildren();
  try {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const xml = extractXmlFromPng(bytes);
    const moddle = new BpmnModdle(structuredClone(moddlePackages) as never) as any;
    const { rootElement: definitions } = await moddle.fromXML(xml);

    const container = document.createElement('div');
    stage.appendChild(container);
    const warnings: string[] = [];
    const canvas = new Canvas({ container, onWarning: (w: string) => warnings.push(w) });
    const scene = canvas.importDefinitions(definitions);

    const nodes = [...scene.elementsById.values()].filter((e) => e.kind === 'node').length;
    const edges = [...scene.elementsById.values()].filter((e) => e.kind === 'edge').length;
    const warn = warnings.length ? ` — ${warnings.length} warning(s)` : '';
    setStatus(`${name}: ${nodes} nodes, ${edges} edges${warn}`);
    if (warnings.length) console.warn(`[harness] ${name} warnings:`, warnings);
  } catch (err) {
    console.error(err);
    setStatus(`${name}: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

async function boot(): Promise<void> {
  moddlePackages = await loadAllSchemas();

  for (const { name } of examples) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    picker.appendChild(opt);
  }

  picker.addEventListener('change', () => {
    const chosen = examples.find((e) => e.name === picker.value);
    if (chosen) void render(chosen.name, chosen.url);
  });

  if (examples.length > 0) {
    picker.value = examples[0].name;
    await render(examples[0].name, examples[0].url);
  } else {
    setStatus('no examples found', true);
  }
}

void boot();
