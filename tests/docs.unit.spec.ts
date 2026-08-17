import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog } from '@core/notation';
import { MODDLE_BUILTIN_TYPES } from '@core/notation/schemaFile';
import { PALETTE_GROUPS } from '@modeler/palette/groups';
import { loadSchemaModels } from './schemas';

/** The docs are hand-written, so nothing but this guard keeps them from drifting off the shipped schemas. */

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

/**
 * Names that look like element types but legitimately are not Studyflow ones. Every entry was
 * triaged against the source named beside it; a name that is merely *wrong* belongs in a fix, not here.
 */
const NAME_ALLOWLIST: Readonly<Record<string, string>> = {
  // extensions.qmd introduces it as the former name of `cognitive:BehaverseTask` ("formerly `behaverse:Task`").
  'behaverse:Task': 'retired schema name, quoted as history',
  // spec.qmd:75 defines it as an EBNF nonterminal of the textual grammar, not as a moddle type.
  ParticipantRef: 'nonterminal of the grammar in reference/spec.qmd',
  // runner-app.qmd documents `registerNode({ Component })` -- React\'s own type.
  Component: "React's component type, in the runner's node API",
  // Keys of the Behaverse Unity bot payload (`botConfigurations`), not moddle properties. Verified in
  // assets/schemas/cognitive.moddle.yaml and in the shipped assets/examples/bot_*.studyflow.png diagrams.
  ResponseSource: 'botConfigurations key of the Behaverse runtime',
  IncludeScreenshot: 'botConfigurations key of the Behaverse runtime',
  SkipInstructions: 'botConfigurations key of the Behaverse runtime',
  MaxResponseTime: 'botConfigurations key of the Behaverse runtime',
  Speed: 'botConfigurations key of the Behaverse runtime',
};

/** Names that never existed, or stopped existing. Reintroducing one is the drift this guard exists to stop. */
const DENIED_NAMES: readonly string[] = [
  'VideoGame', 'DataStorage', 'Snapshot', 'requiresConsent', 'schemaRef', 'randomOrder',
  'core.moddle.yaml', 'OmniProcess', 'DataTrove', 'OpenBCI', 'CognitiveTest', 'BPMN 2.1',
];

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

/** Marks the fenced-code and frontmatter lines of a file. Split out so the checks below can be self-tested. */
function scanQuoted(lines: readonly string[]): { quoted: boolean[]; frontmatterEnd: number } {
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

  return { quoted, frontmatterEnd };
}

function readPage(file: string): Page {
  const lines = readFileSync(file, 'utf8').split('\n');
  const { quoted, frontmatterEnd } = scanQuoted(lines);

  return {
    rel: path.relative(ROOT, file),
    dir: path.dirname(file),
    lines,
    quoted,
    frontmatter: frontmatterEnd > 0 ? lines.slice(1, frontmatterEnd).join('\n') : null,
  };
}

const PAGES: Page[] = qmdFiles(DOCS_DIR).sort().map(readPage);

/** `docs/develop/` is written for the people changing the tools; every other page is written for readers. */
const DEVELOP_DIR = path.join(DOCS_DIR, 'develop');
const READER_PAGES = PAGES.filter((page) => path.relative(DEVELOP_DIR, page.dir).startsWith('..'));

/** One assertion per check, so a single run lists every page that needs work. */
function report(found: string[], headline: string): void {
  const problems = [...new Set(found)];
  expect(problems.length, [`${problems.length} ${headline}:`, ...problems].join('\n')).toBe(0);
}

test('there are docs to lint', () => {
  // Without this, a broken walk would turn every check below into a silent pass.
  expect(PAGES.length, 'no .qmd pages found under docs/').toBeGreaterThan(10);
  expect(KNOWN_NAMES.size, 'the schema catalog compiled to nothing').toBeGreaterThan(50);
  // Same trap for the register checks: they must see most of docs/, and none of docs/develop/.
  expect(READER_PAGES.length, 'no reader-facing pages found under docs/').toBeGreaterThan(10);
  expect(READER_PAGES.length, 'docs/develop/ walked as reader-facing').toBeLessThan(PAGES.length);
  expect(READER_PAGES.filter((page) => page.rel.includes('develop'))).toEqual([]);
});

/* -------------------------------------------------------------------------- */
/* 1. Element names resolve                                                    */
/* -------------------------------------------------------------------------- */

/** `Study`, `bpmn:Task`, `cognitive:RandomGateway` -- optional lowercase prefix, PascalCase local name. */
const TYPE_TOKEN = /^(?:([a-z][A-Za-z0-9]*):)?([A-Z][A-Za-z0-9]*)$/;

/** Whether a backticked token is making a claim about an element or type name at all. */
function typeNameIn(token: string): { prefix?: string; local: string } | null {
  const match = TYPE_TOKEN.exec(token);
  if (!match) return null;
  const [, prefix, local] = match;
  // Bare acronyms (`PATCH`, `NB`, `BCS`) name HTTP verbs and enum values; no shipped type is all-caps.
  if (!prefix && !/[a-z]/.test(local)) return null;
  return { prefix, local };
}

function resolvesToShippedName(token: string): boolean {
  const parsed = typeNameIn(token);
  if (!parsed) return true;
  const { prefix, local } = parsed;
  if (prefix === 'bpmn') return isBpmnType(local);
  if (prefix) return !!catalog.getType(token) || !!catalog.enumOf(token);
  return KNOWN_NAMES.has(local) || isBpmnType(local);
}

test('the name check can tell a shipped name from a made-up one', () => {
  // Pins the resolver's own behaviour: weakening it to make a page pass has to break this first.
  for (const good of ['CognitiveTask', 'bpmn:Task', 'cognitive:RandomGateway', 'studyflow:Dataset', 'Documentation']) {
    expect(resolvesToShippedName(good), good).toBe(true);
  }
  for (const bad of ['VideoGame', 'bpmn:VideoGame', 'behaverse:Task', 'DataTrove']) {
    expect(resolvesToShippedName(bad), bad).toBe(false);
  }
  // Not element-name shaped, so never asked about.
  for (const skipped of ['PATCH', 'maxResponseTime', 'assets/schemas', 'a b']) {
    expect(typeNameIn(skipped), skipped).toBeNull();
  }
});

/* Reader pages only: a PascalCase name in `docs/develop/` is usually a code symbol (`ExportModel`,
 * `ServiceResolver`), and the schema catalog is the wrong authority for those. Retired names are still
 * denied everywhere -- check 2 walks every page -- so this exemption cannot let real drift back in. */
test('every element name a page prints is one the schemas ship', () => {
  const problems: string[] = [];
  for (const page of READER_PAGES) {
    page.lines.forEach((line, i) => {
      if (page.quoted[i]) return;
      for (const span of line.matchAll(/`([^`\n]+)`/g)) {
        const token = span[1];
        if (!typeNameIn(token)) continue;
        if (token in NAME_ALLOWLIST) continue;
        if (resolvesToShippedName(token)) continue;
        problems.push(
          `${page.rel}:${i + 1}: \`${token}\` is not a type, enum, enum value, inspector category, `
          + 'template, or palette entry of any shipped schema. Rename it to the name that ships, or -- if it '
          + 'is deliberately not a Studyflow name -- add it to NAME_ALLOWLIST in tests/docs.unit.spec.ts '
          + 'with the source that backs it.',
        );
      }
    });
  }
  report(problems, 'unresolved element name(s) in docs');
});

/* -------------------------------------------------------------------------- */
/* 2. Retired names stay retired                                               */
/* -------------------------------------------------------------------------- */

function deniedPattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const left = /^[A-Za-z0-9]/.test(name) ? '\\b' : '';
  const right = /[A-Za-z0-9]$/.test(name) ? '\\b' : '';
  return new RegExp(`${left}${escaped}${right}`);
}

test('the retired-name matcher is exact', () => {
  expect(deniedPattern('BPMN 2.1').test('conforms to BPMN 2.1 today')).toBe(true);
  expect(deniedPattern('BPMN 2.1').test('conforms to BPMN 2.0 today')).toBe(false);
  expect(deniedPattern('Snapshot').test('a `Snapshot` element')).toBe(true);
  expect(deniedPattern('Snapshot').test('takes snapshots of the run')).toBe(false);
  expect(deniedPattern('core.moddle.yaml').test('edit core.moddle.yaml')).toBe(true);
  expect(deniedPattern('core.moddle.yaml').test('edit studyflow.moddle.yaml')).toBe(false);
});

test('no page revives a name that does not exist', () => {
  const patterns = DENIED_NAMES.map((name) => [name, deniedPattern(name)] as const);
  const problems: string[] = [];
  for (const page of PAGES) {
    // Whole file, fences included: a denied name in a YAML sample is just as wrong as one in prose.
    page.lines.forEach((line, i) => {
      for (const [name, pattern] of patterns) {
        if (!pattern.test(line)) continue;
        problems.push(
          `${page.rel}:${i + 1}: "${name}" does not exist and must not be documented. `
          + 'Delete the sentence or replace it with the name that ships '
          + '(check `assets/schemas/*.moddle.yaml`).',
        );
      }
    });
  }
  report(problems, 'retired name(s) in docs');
});

/* -------------------------------------------------------------------------- */
/* 3. Links and images point at files                                          */
/* -------------------------------------------------------------------------- */

const LINK = /(!?)\[(?:[^\][]|\[[^\]]*\])*\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\{\{)/i;

/* An `<!-- ... -->`-commented link is checked too, on purpose: a path parked in a comment is a
 * promise about a file, and a promise no file keeps is exactly the rot this suite exists to find. */

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
            + `${path.relative(ROOT, resolved)}, which does not exist. Add the file, or point the `
            + `${bang ? 'image' : 'link'} at the page that does.`,
          );
          continue;
        }
        /* On disk is not enough: Quarto only publishes what lives under the project directory, so a
         * path that climbs out of docs/ resolves here and 404s on the built site. */
        if (path.relative(DOCS_DIR, resolved).startsWith('..')) {
          problems.push(
            `${page.rel}:${i + 1}: ${bang ? 'image' : 'link'} "${rawTarget}" climbs out of docs/ to `
            + `${path.relative(ROOT, resolved)}. It exists, but Quarto publishes only what is inside `
            + 'the project, so this breaks on the built site. Copy the file under docs/assets/ and '
            + 'point at that copy.',
          );
        }
      }
    });
  }
  report(problems, 'broken link(s) in docs');
});

/* -------------------------------------------------------------------------- */
/* 4. Frontmatter                                                              */
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
        `${page.rel}:1: frontmatter has no ${key}. Add \`${key}: ...\` -- `
        + `it is what the sidebar, the search index, and the social card read.`,
      );
    }
  }
  report(problems, 'page(s) with incomplete frontmatter');
});

/* -------------------------------------------------------------------------- */
/* 5. No shipped TODOs                                                         */
/* -------------------------------------------------------------------------- */

const CALLOUT_OPEN = /^:{3,}\s*\{?\s*\.?(callout-[a-z]+)\b([^}]*)\}?\s*$/;
const CALLOUT_CLOSE = /^:{3,}\s*$/;
const MISSING_CONTENT = /\b(TODO|TBD|FIXME|WIP)\b|coming soon|to be (written|added|filled)|not yet (written|documented)|under construction/i;

test('no callout announces content that has not been written', () => {
  const problems: string[] = [];
  for (const page of PAGES) {
    let inCallout = false;
    page.lines.forEach((line, i) => {
      if (!inCallout) {
        const open = CALLOUT_OPEN.exec(line.trim());
        if (open) inCallout = true;
        if (open && MISSING_CONTENT.test(open[2])) {
          problems.push(
            `${page.rel}:${i + 1}: callout title announces missing content ("${line.trim()}"). `
            + 'Write the content, or delete the callout -- a shipped page must not advertise its own gaps.',
          );
        }
        return;
      }
      if (CALLOUT_CLOSE.test(line.trim())) {
        inCallout = false;
        return;
      }
      if (MISSING_CONTENT.test(line)) {
        problems.push(
          `${page.rel}:${i + 1}: callout body announces missing content ("${line.trim().slice(0, 80)}"). `
          + 'Write the content, or delete the callout.',
        );
      }
    });
  }
  report(problems, 'unfinished callout(s) in docs');
});

/* -------------------------------------------------------------------------- */
/* 6. Reader-facing pages keep the reader's register                           */
/* -------------------------------------------------------------------------- */

/* A reader-facing page is written for cognitive scientists and AI researchers: it says what a study
 * means and what running it does. How the tools are built is real, but it is evidence for a different
 * reader, so it lives in docs/develop/ -- or, when a page owes its reader the mechanics, in that page's
 * collapsed "Under the hood" callout. The two checks below make that split mechanical. */

/** Where a page parks its mechanics: `::: {.callout-note collapse="true"}` + `## Under the hood`. */
const UNDER_THE_HOOD = /^under the hood\b/i;
const DIV_FENCE = /^:{3,}(.*)$/;
const DIV_CALLOUT = /\{[^}]*\.callout-[a-z]+/;
const DIV_TITLE = /title\s*=\s*["']([^"']*)["']/;
const HEADING = /^#{1,6}\s+(\S.*)$/;

/**
 * Marks the lines of every "Under the hood" callout, fences included. Pages nest no divs, so one level.
 * `quoted` keeps a `:::` *shown* in a code sample from desyncing the scan and exempting real prose.
 */
function underTheHoodLines(lines: string[], quoted: readonly boolean[] = []): boolean[] {
  const hooded = lines.map(() => false);
  let start = -1;
  let title = '';
  lines.forEach((line, i) => {
    if (quoted[i]) return;
    const fence = DIV_FENCE.exec(line.trim());
    if (!fence) {
      // A callout with no `title=` takes its title from the heading that opens it.
      if (start >= 0 && !title) title = HEADING.exec(line.trim())?.[1] ?? '';
      return;
    }
    if (start < 0) {
      // Only a callout can carry the exemption; `::: {layout-ncol=2}` and friends are just layout.
      start = DIV_CALLOUT.test(fence[1]) ? i : -1;
      title = start < 0 ? '' : DIV_TITLE.exec(fence[1])?.[1] ?? '';
      return;
    }
    if (UNDER_THE_HOOD.test(title)) for (let j = start; j <= i; j += 1) hooded[j] = true;
    start = -1;
    title = '';
  });
  return hooded;
}

/** A path into the source tree -- `packages/core/src/...`, `tests/docs.unit.spec.ts`, or the bare directory. */
const IMPLEMENTATION_PATH = /(?<![\w/-])(?:packages|tests)\/[\w./-]*/g;

function citedPaths(line: string): string[] {
  return [...line.matchAll(IMPLEMENTATION_PATH)].map((match) => match[0]);
}

/**
 * Words for how the tools are built, each paired with the domain phrasing that says the same thing to
 * a reader. None of them means anything inside a study, which is what makes the check mechanical. Should
 * one ever start to -- a *trial registry* is a real place a scientist registers a study -- narrow that
 * word's pattern here, with the sentence that forced it. Exempting the page is not the fix.
 */
const IMPLEMENTATION_WORDS: Readonly<Record<string, string>> = {
  moddle: 'name the schema, or the element type it defines',
  'async generator': 'say the run advances one step at a time',
  mulberry32: 'say the run draws from a seeded random number generator',
  dispatcher: 'say what actually happens to the step',
  registry: 'say which element kinds a run can execute',
  codec: 'name the file format the study is read from or written to',
  metamodel: 'say "the schemas", or "what a studyflow can contain"',
  'business object': 'say "the element", or "its attributes"',
  superClass: 'say which element kind it extends',
  'self-register': 'say the tool picks it up on its own',
  iTXt: 'say the image carries its own source',
};

/** Whole words, case-insensitively, including the plural or participle a page would reach for. */
function jargonPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  const inflected = escaped.endsWith('y')
    ? `(?:${escaped}|${escaped.slice(0, -1)}ies)`
    : `${escaped}(?:e?s|ing|ed)?`;
  return new RegExp(`\\b${inflected}\\b`, 'i');
}

const JARGON: readonly (readonly [string, RegExp])[] =
  Object.keys(IMPLEMENTATION_WORDS).map((term) => [term, jargonPattern(term)] as const);

function jargonIn(line: string): string[] {
  return JARGON.filter(([, pattern]) => pattern.test(line)).map(([term]) => term);
}

test('the register matchers are exact', () => {
  // Pins both matchers, so loosening one to make a page pass has to break this first.
  expect(citedPaths('reads `packages/core/src/notation/loader.ts` at boot'))
    .toEqual(['packages/core/src/notation/loader.ts']);
  expect(citedPaths('guarded by `tests/docs.unit.spec.ts`')).toEqual(['tests/docs.unit.spec.ts']);
  expect(citedPaths('everything in tests/ runs in one lane')).toEqual(['tests/']);
  expect(citedPaths('a study packages its own tasks, and the tests pass')).toEqual([]);
  expect(citedPaths('see https://github.com/behaverse/studyflow-modeler/tests/x')).toEqual([]);

  expect(jargonIn('the moddle descriptor behind it')).toEqual(['moddle']);
  expect(jargonIn('two registries of node kinds')).toEqual(['registry']);
  expect(jargonIn('an async generator yields each step')).toEqual(['async generator']);
  expect(jargonIn('each kind self-registers at startup')).toEqual(['self-register']);
  expect(jargonIn('kept in the PNG\'s iTXt chunk')).toEqual(['iTXt']);
  // Domain prose that merely looks close: no entry may claim these.
  expect(jargonIn('a modeller models the study, and the model runs')).toEqual([]);
  expect(jargonIn('register the trial before collecting data')).toEqual([]);
});

test('the "Under the hood" exemption covers that block and nothing else', () => {
  const page = [
    'prose',
    '::: {.callout-note collapse="true"}',
    '## Under the hood',
    'it reads `packages/core/src/x.ts`',
    ':::',
    'more prose',
    '::: {.callout-tip}',
    '## Publishing',
    ':::',
  ];
  expect(underTheHoodLines(page)).toEqual([false, true, true, true, true, false, false, false, false]);
  // The title may also be an attribute, and a plain layout div never exempts anything.
  expect(underTheHoodLines(['::: {.callout-note title="Under the hood"}', 'x', ':::']))
    .toEqual([true, true, true]);
  expect(underTheHoodLines(['::: {layout-ncol=2}', '## Under the hood', ':::']))
    .toEqual([false, false, false]);
  // A `:::` quoted in a code sample opens nothing, so the prose after it stays checked.
  expect(underTheHoodLines(['::: {.callout-note}', 'x', ':::'], [true, true, true]))
    .toEqual([false, false, false]);
});

test('no reader-facing page cites a path into the source tree', () => {
  const problems: string[] = [];
  for (const page of READER_PAGES) {
    const hooded = underTheHoodLines(page.lines, page.quoted);
    page.lines.forEach((line, i) => {
      if (page.quoted[i] || hooded[i]) return;
      for (const cited of citedPaths(line)) {
        problems.push(
          `${page.rel}:${i + 1}: prose cites "${cited}". This page is written for cognitive scientists `
          + 'and AI researchers, and where the code lives is not evidence they can act on. Say what the '
          + 'tool does instead, and move the file path to docs/develop/ or into this page\'s collapsed '
          + '"Under the hood" callout -- inside a fenced code block it is fine, because a reader types it.',
        );
      }
    });
  }
  report(problems, 'implementation path(s) cited in reader-facing prose');
});

test('no reader-facing page reaches for implementation vocabulary', () => {
  const problems: string[] = [];
  for (const page of READER_PAGES) {
    page.lines.forEach((line, i) => {
      if (page.quoted[i]) return;
      for (const term of jargonIn(line)) {
        problems.push(
          `${page.rel}:${i + 1}: "${term}" names how the tools are built, not what a study means -- `
          + `${IMPLEMENTATION_WORDS[term]}. Reword it for cognitive scientists and AI researchers, or `
          + 'move the sentence to docs/develop/, which is written for engineers.',
        );
      }
    });
  }
  report(problems, 'implementation word(s) in reader-facing prose');
});

/* -------------------------------------------------------------------------- */
/* 7. Pages stay inside a reading budget                                       */
/* -------------------------------------------------------------------------- */

/* The reader is a domain expert who does not want to get involved with too much detail, so length is a
 * correctness property, not taste: a page that overexplains has failed even when every word in it is
 * true. The budgets below are per section and sit a little above what the longest page in each section
 * spends today, so this catches a page *growing* rather than the docs as written. There is deliberately
 * no per-page exception -- a page that cannot fit is a page to tabulate, cut, or link out of. */

/* File entries come before the directory that contains them: `budgetFor` takes the first match. */
const PROSE_BUDGETS: readonly (readonly [target: string, words: number])[] = [
  ['docs/index.qmd', 200],
  // Catalogue and worked-example pages: one entry per item, or one trial carried end to end,
  // so they run longer than the pages around them.
  ['docs/design/relations.qmd', 750],
  ['docs/design/protocols.qmd', 650],
  ['docs/reference/elements.qmd', 750],
  ['docs/start/', 450],
  ['docs/design/', 450],
  ['docs/run/', 550],
  ['docs/reference/', 550],
  ['docs/develop/', 1000],
];

/** `faq.qmd`, `roadmap.qmd`: the pages hanging off the root, each answering one question. */
const ROOT_PAGE_BUDGET: readonly [target: string, words: number] = ['docs/*.qmd', 350];

/** A directory entry covers everything under it; a file entry covers itself. */
function budgetFor(page: Page): readonly [target: string, words: number] {
  const rel = page.rel.split(path.sep).join('/');
  return PROSE_BUDGETS.find(([target]) => (target.endsWith('/') ? rel.startsWith(target) : rel === target))
    ?? ROOT_PAGE_BUDGET;
}

/** Tables and figures are scanned, not read, so neither is charged to the page that carries them. */
const SCANNED_LINE = /^\s*(?:\||!\[)/;

/**
 * Whitespace-separated tokens of prose: the file minus frontmatter, fenced code, table rows and figures.
 * A `##` or a bullet dash counts, because the measure is how much page a reader has to move through.
 */
function proseWords(lines: readonly string[], quoted: readonly boolean[]): number {
  let words = 0;
  lines.forEach((line, i) => {
    if (quoted[i] || SCANNED_LINE.test(line)) return;
    for (const token of line.split(/\s+/)) if (token) words += 1;
  });
  return words;
}

test('the prose counter charges a page for prose only', () => {
  // Pins the counter, so widening what it ignores to make a page fit has to break this first.
  const page = [
    '---', 'title: Kept out', 'description: so is this', '---',
    '## Two words',
    'A sentence of five words.',
    '```yaml',
    'not: counted at all',
    '```',
    '| a table | of facts |',
    '  | indented row | too |',
    '![A figure with a long caption](assets/img/x.png)',
    'Done.',
  ];
  // `## Two words` (3) + the sentence (5) + `Done.` (1).
  expect(proseWords(page, scanQuoted(page).quoted)).toBe(9);
  // Blank lines and a fence that never closes are still not prose.
  expect(proseWords(['', '   ', 'one'], [false, false, false])).toBe(1);
  expect(proseWords(['```', 'a b c'], scanQuoted(['```', 'a b c']).quoted)).toBe(0);
});

test('every prose budget covers pages that exist', () => {
  // A renamed section would otherwise fall back to the root budget and mis-report every page under it.
  for (const [target] of PROSE_BUDGETS) {
    const covered = PAGES.filter((page) => budgetFor(page)[0] === target);
    expect(covered.length, `no page matches the "${target}" prose budget -- rename it or drop it`)
      .toBeGreaterThan(0);
  }
});

test('no page outgrows the reading budget for its section', () => {
  const problems: string[] = [];
  for (const page of PAGES) {
    const [target, budget] = budgetFor(page);
    const words = proseWords(page.lines, page.quoted);
    if (words <= budget) continue;
    problems.push(
      `${page.rel}: ${words} words of prose, ${words - budget} over the ${budget}-word budget for `
      + `${target}. Move the facts into a table, cut the explanation, or link the page that already `
      + 'says it instead of restating it -- tables and figures are not counted, so tabulating is free. '
      + 'Raising the budget in tests/docs.unit.spec.ts is not the fix.',
    );
  }
  report(problems, 'over-long page(s) in docs');
});
