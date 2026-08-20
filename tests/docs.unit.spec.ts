import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog } from '@core/notation';
import { MODDLE_BUILTIN_TYPES } from '@core/notation/schemaFile';
import { PALETTE_GROUPS } from '@modeler/palette/groups';
import { loadSchemaModels } from './schemas';

/** The docs are hand-written, so this guard keeps them from drifting off the shipped schemas:
 * every element name must resolve, every link must land, every page must have a title. Style,
 * register, and length are editorial calls (see docs/README.md), not lint failures. */

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, 'docs');

/* -------------------------------------------------------------------------- */
/* The vocabulary a page is allowed to name                                    */
/* -------------------------------------------------------------------------- */

const catalog = buildCatalog(loadSchemaModels());
// No extension packages: this instance is asked one question only, "is `bpmn:X` a real BPMN 2.0 type?".
const bpmn = new BpmnModdle({}) as any;

function isBpmnType(localName: string): boolean {
  try {
    return !!bpmn.registry.getEffectiveDescriptor(`bpmn:${localName}`);
  } catch {
    return false;
  }
}

/** Every PascalCase name the shipped schemas and the palette actually put in front of a reader. */
const KNOWN_NAMES: ReadonlySet<string> = (() => {
  const names = new Set<string>(MODDLE_BUILTIN_TYPES);
  for (const type of catalog.allTypes()) {
    names.add(type.name);
    names.add(type.ns.localName);
  }
  for (const schema of catalog.schemas) {
    names.add(schema.name); // the display name, e.g. `Core` for the `studyflow` prefix
    for (const entry of schema.enums) {
      names.add(entry.name);
      names.add(entry.ns.localName);
      for (const literal of entry.literals) {
        names.add(literal.name);
        if (typeof literal.value === 'string') names.add(literal.value);
      }
    }
    for (const category of schema.categories) names.add(category.name);
    for (const template of schema.templates) names.add(template.name);
  }
  for (const group of PALETTE_GROUPS) {
    names.add(group.label);
    for (const item of group.items) names.add(item.label);
  }
  return names;
})();

/** Names that look like element types but legitimately are not Studyflow ones. */
const NAME_ALLOWLIST: Readonly<Record<string, string>> = {};

/* -------------------------------------------------------------------------- */
/* Reading the pages                                                           */
/* -------------------------------------------------------------------------- */

type Page = {
  /** Repo-relative, so a failure message can be pasted into an editor. */
  rel: string;
  dir: string;
  lines: string[];
  /** True where the line is fenced code or YAML frontmatter -- sample text, not a claim about the vocabulary. */
  quoted: boolean[];
  frontmatter: string | null;
};

function qmdFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) qmdFiles(full, out);
    else if (entry.name.endsWith('.qmd')) out.push(full);
  }
  return out;
}

function readPage(file: string): Page {
  const lines = readFileSync(file, 'utf8').split('\n');
  const quoted: boolean[] = [];
  let fence: string | null = null;
  let frontmatterEnd = -1;

  if (lines[0]?.trim() === '---') {
    frontmatterEnd = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  }
  lines.forEach((line, i) => {
    if (i <= frontmatterEnd) {
      quoted.push(true);
      return;
    }
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      quoted.push(true);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      fence = marker;
      quoted.push(true);
    } else {
      quoted.push(false);
    }
  });

  return {
    rel: path.relative(ROOT, file),
    dir: path.dirname(file),
    lines,
    quoted,
    frontmatter: frontmatterEnd > 0 ? lines.slice(1, frontmatterEnd).join('\n') : null,
  };
}

const PAGES: Page[] = qmdFiles(DOCS_DIR).sort().map(readPage);

/** One assertion per check, so a single run lists every page that needs work. */
function report(found: string[], headline: string): void {
  const problems = [...new Set(found)];
  expect(problems.length, [`${problems.length} ${headline}:`, ...problems].join('\n')).toBe(0);
}

test('there are docs to lint', () => {
  // Without this, a broken walk would turn every check below into a silent pass.
  expect(PAGES.length, 'no .qmd pages found under docs/').toBeGreaterThan(2);
  expect(KNOWN_NAMES.size, 'the schema catalog compiled to nothing').toBeGreaterThan(50);
});

/* -------------------------------------------------------------------------- */
/* 1. Element names resolve                                                    */
/* -------------------------------------------------------------------------- */

/** `Study`, `bpmn:Task`, `cognitive:RandomGateway` -- optional lowercase prefix, PascalCase local name. */
const TYPE_TOKEN = /^(?:([a-z][A-Za-z0-9]*):)?([A-Z][A-Za-z0-9]*)$/;

function resolvesToShippedName(token: string): boolean {
  const match = TYPE_TOKEN.exec(token);
  if (!match) return true;
  const [, prefix, local] = match;
  // Bare acronyms (`PATCH`, `NB`, `BCS`) name HTTP verbs and enum values; no shipped type is all-caps.
  if (!prefix && !/[a-z]/.test(local)) return true;
  if (prefix === 'bpmn') return isBpmnType(local);
  if (prefix) return !!catalog.getType(token) || !!catalog.enumOf(token);
  return KNOWN_NAMES.has(local) || isBpmnType(local);
}

test('the name check can tell a shipped name from a made-up one', () => {
  // Pins the resolver's own behaviour: weakening it to make a page pass has to break this first.
  for (const good of ['CognitiveTask', 'bpmn:Task', 'cognitive:RandomGateway', 'studyflow:Dataset', 'PATCH']) {
    expect(resolvesToShippedName(good), good).toBe(true);
  }
  for (const bad of ['VideoGame', 'bpmn:VideoGame', 'behaverse:Task', 'DataTrove']) {
    expect(resolvesToShippedName(bad), bad).toBe(false);
  }
});

test('every element name a page prints is one the schemas ship', () => {
  const problems: string[] = [];
  for (const page of PAGES) {
    page.lines.forEach((line, i) => {
      if (page.quoted[i]) return;
      for (const span of line.matchAll(/`([^`\n]+)`/g)) {
        const token = span[1];
        if (token in NAME_ALLOWLIST) continue;
        if (resolvesToShippedName(token)) continue;
        problems.push(
          `${page.rel}:${i + 1}: \`${token}\` is not a type, enum, enum value, inspector category, `
          + 'template, or palette entry of any shipped schema. Rename it to the name that ships, or -- if it '
          + 'is deliberately not a Studyflow name -- add it to NAME_ALLOWLIST in tests/docs.unit.spec.ts.',
        );
      }
    });
  }
  report(problems, 'unresolved element name(s) in docs');
});

/* -------------------------------------------------------------------------- */
/* 2. Links and images point at files                                          */
/* -------------------------------------------------------------------------- */

const LINK = /(!?)\[(?:[^\][]|\[[^\]]*\])*\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\{\{)/i;

test('every relative link and image resolves to a file', () => {
  const problems: string[] = [];
  for (const page of PAGES) {
    page.lines.forEach((line, i) => {
      if (page.quoted[i]) return;
      for (const link of line.matchAll(LINK)) {
        const [, bang, rawTarget] = link;
        if (EXTERNAL.test(rawTarget)) continue;
        const target = decodeURI(rawTarget.split('#')[0].split('?')[0]);
        if (!target) continue;
        const resolved = target.startsWith('/')
          ? path.join(DOCS_DIR, target)
          : path.resolve(page.dir, target);
        if (!existsSync(resolved)) {
          problems.push(
            `${page.rel}:${i + 1}: ${bang ? 'image' : 'link'} "${rawTarget}" resolves to `
            + `${path.relative(ROOT, resolved)}, which does not exist.`,
          );
          continue;
        }
        /* On disk is not enough: Quarto only publishes what lives under the project directory, so a
         * path that climbs out of docs/ resolves here and 404s on the built site. */
        if (path.relative(DOCS_DIR, resolved).startsWith('..')) {
          problems.push(
            `${page.rel}:${i + 1}: ${bang ? 'image' : 'link'} "${rawTarget}" climbs out of docs/ to `
            + `${path.relative(ROOT, resolved)}, which 404s on the built site. Copy the file under `
            + 'docs/assets/ and point at that copy.',
          );
        }
      }
    });
  }
  report(problems, 'broken link(s) in docs');
});

/* -------------------------------------------------------------------------- */
/* 3. Frontmatter                                                              */
/* -------------------------------------------------------------------------- */

test('every page declares a title and a description', () => {
  const problems: string[] = [];
  for (const page of PAGES) {
    if (page.frontmatter === null) {
      problems.push(`${page.rel}:1: no YAML frontmatter. Add a "---" block with title and description.`);
      continue;
    }
    for (const key of ['title', 'description']) {
      const value = new RegExp(`^${key}:[ \\t]*(\\S.*)$`, 'm').exec(page.frontmatter)?.[1];
      if (value && value.replace(/["']/g, '').trim()) continue;
      problems.push(
        `${page.rel}:1: frontmatter has no ${key} -- it is what the sidebar, the search index, `
        + 'and the social card read.',
      );
    }
  }
  report(problems, 'page(s) with incomplete frontmatter');
});
