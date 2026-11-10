/**
 * CONSORT 2025 (Hopewell et al., 2025): the participant flow diagram of a randomised trial, worded as the statement
 * words it and drawn from the study's own participant flow (`participantFlow.ts`). Only the boxes and lines the study
 * has an element for are drawn: one column per arm while the arms keep paths of their own, one box across them once
 * their paths have joined.
 */
import type { StudyModel } from '@core/model/index';
import type { Guideline } from '@skills/reporting-guidelines/modeler/guideline';
import { nameOf, participantFlowOf, type Arm, type Attrition, type Exit, type ParticipantFlow } from '@skills/reporting-guidelines/modeler/participantFlow';
import { INK, escapeXml, num, svgDocument, wrap } from '@skills/reporting-guidelines/modeler/svg';

/** The statement's wording, in the spelling the tools write (`Enrollment`, `Randomized`). */
const WORDS = {
  enrollment: 'Enrollment',
  allocation: 'Allocation',
  followUp: 'Follow-up',
  analysis: 'Analysis',
  assessed: 'Assessed for eligibility',
  enrolled: 'Enrolled',
  excluded: 'Excluded',
  randomized: 'Randomized',
  allocatedTo: 'Allocated to',
  received: 'Received allocated intervention',
  analyzed: 'Analyzed',
} as const;

const ATTRITION: Record<Exclude<Attrition, 'excluded'>, string> = {
  'not-received': 'Did not receive allocated intervention',
  'lost-to-follow-up': 'Lost to follow-up',
  discontinued: 'Discontinued intervention',
  'excluded-from-analysis': 'Excluded from analysis',
};

/** One line of a box: a `head` in bold, a `sub` indented under the head it gives a reason for. */
export type Line = { text: string; style: 'head' | 'plain' | 'sub' };

/** One row under the allocation: a box per arm (none where an arm has nothing to say), or one box across the arms. */
export type Row = { phase?: string; cells: (Line[] | undefined)[] } | { phase?: string; across: Line[] };

export type ConsortFlow = {
  /** What the picture is of: the study's name. */
  study: string;
  assessed: string;
  excluded?: Line[];
  randomized: string;
  arms: number;
  rows: Row[];
};

const counted = (text: string, n: number): string => `${text} (n=${n})`;

/** The exits of one kind as CONSORT lists them: their total under the kind's name, then each reason. */
function listed(exits: Exit[], attrition: Exclude<Attrition, 'excluded'>): Line[] {
  const of = exits.filter((exit) => exit.attrition === attrition);
  if (of.length === 0) return [];
  return [
    { text: counted(ATTRITION[attrition], of.reduce((sum, exit) => sum + exit.n, 0)), style: 'head' },
    ...of.map((exit): Line => ({ text: counted(exit.reason, exit.n), style: 'sub' })),
  ];
}

/** The flow in CONSORT's words, box by box. */
export function consortFlow(model: StudyModel, flow: ParticipantFlow): ConsortFlow {
  const { arms, shared } = flow;
  const all = arms.length === 2 ? 'both' : 'all';
  const rows: Row[] = [];
  const begun = new Set<string>();
  /** A row, under its phase's name when it is the first of that phase. */
  const add = (phase: string, row: { cells: (Line[] | undefined)[] } | { across: Line[] }): void => {
    rows.push(begun.has(phase) ? row : { phase, ...row });
    begun.add(phase);
  };
  /** One box per arm, none for an arm with nothing to say. */
  const perArm = (lines: (arm: Arm) => Line[]): (Line[] | undefined)[] => arms.map((arm) => {
    const said = lines(arm);
    return said.length > 0 ? said : undefined;
  });

  add(WORDS.allocation, {
    cells: perArm((arm) => [
      { text: counted(`${WORDS.allocatedTo} ${arm.name}`, arm.allocated), style: 'head' },
      ...(arm.received === undefined ? [] : [{ text: counted(WORDS.received, arm.received), style: 'plain' } as Line]),
      ...listed(arm.exits, 'not-received'),
    ]),
  });

  const followed = perArm((arm) => [...listed(arm.exits, 'lost-to-follow-up'), ...listed(arm.exits, 'discontinued')]);
  if (followed.some(Boolean)) add(WORDS.followUp, { cells: followed });
  const followedTogether = [...listed(shared.exits, 'lost-to-follow-up'), ...listed(shared.exits, 'discontinued')];
  if (followedTogether.length > 0) add(WORDS.followUp, { across: [{ text: `${all[0].toUpperCase()}${all.slice(1)} groups`, style: 'head' }, ...followedTogether] });

  const analyzed = perArm((arm) => [
    ...(arm.completed === undefined ? [] : [{ text: counted(WORDS.analyzed, arm.completed), style: 'head' } as Line]),
    ...listed(arm.exits, 'excluded-from-analysis'),
  ]);
  if (analyzed.some(Boolean)) add(WORDS.analysis, { cells: analyzed });
  const analyzedTogether = [
    ...(shared.completed === undefined ? [] : [{ text: counted(`${WORDS.analyzed}, ${all} groups`, shared.completed), style: 'head' } as Line]),
    ...listed(shared.exits, 'excluded-from-analysis'),
  ];
  if (analyzedTogether.length > 0) add(WORDS.analysis, { across: analyzedTogether });

  const excluded = flow.excluded.length === 0 ? undefined : [
    { text: counted(WORDS.excluded, flow.excluded.reduce((sum, exit) => sum + exit.n, 0)), style: 'head' } as Line,
    ...flow.excluded.map((exit): Line => ({ text: counted(exit.reason, exit.n), style: 'sub' })),
  ];
  return {
    study: nameOf(model, model.primaryRoot()) || nameOf(model, flow.container),
    assessed: counted(flow.screening ? WORDS.assessed : WORDS.enrolled, flow.entered),
    excluded,
    randomized: counted(WORDS.randomized, flow.allocated),
    arms: arms.length,
    rows,
  };
}

/* --- the drawing --- */

const SIZE = 12;
const LEADING = 17;
const MARGIN = 16;
const GUTTER = 16;
const COLUMN = 240;
const INSET = { x: 10, y: 9 };
const INDENT = 12;
/** The room a row leaves above it for its arrows, and for its phase's name when it starts one. */
const DROP = { plain: 24, phase: 36 };

/** Lines as a box holds them: each where it starts, and how tall they stand together. */
type Typeset = { lines: { text: string; x: number; bold: boolean }[]; height: number };

/** `lines` set in a box `width` wide: each wrapped, a reason indented under its head. */
function typeset(lines: Line[], width: number): Typeset {
  const out: Typeset['lines'] = [];
  for (const { text, style } of lines) {
    const x = INSET.x + (style === 'sub' ? INDENT : 0);
    for (const line of wrap(text, width - x - INSET.x, SIZE, style === 'head')) out.push({ text: line, x, bold: style === 'head' });
  }
  return { lines: out, height: 2 * INSET.y + out.length * LEADING };
}

/** The diagram as SVG. */
export function drawConsort(flow: ConsortFlow): string {
  const width = 2 * MARGIN + flow.arms * COLUMN + (flow.arms - 1) * GUTTER;
  const inner = width - 2 * MARGIN;
  const middle = width / 2;
  const columnX = (arm: number): number => MARGIN + arm * (COLUMN + GUTTER);
  const centre = (arm: number): number => columnX(arm) + COLUMN / 2;
  const body: string[] = [
    '<defs>',
    `  <marker id="consort-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${INK.stroke}"/></marker>`,
    '</defs>',
  ];
  const box = (x: number, y: number, w: number, h: number): void => {
    body.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="3" fill="${INK.box}" stroke="${INK.muted}"/>`);
  };
  const text = (x: number, y: number, content: string, attributes = ''): void => {
    body.push(`<text x="${num(x)}" y="${num(y)}"${attributes}>${escapeXml(content)}</text>`);
  };
  const line = (d: string, arrow = true): void => {
    body.push(`<path d="${d}" fill="none" stroke="${INK.stroke}" stroke-width="1.2"${arrow ? ' marker-end="url(#consort-arrow)"' : ''}/>`);
  };
  const phase = (name: string, baseline: number): void => text(MARGIN, baseline, name, ' font-weight="600"');
  /** A box of set lines at (`x`, `y`), `height` tall when it is to match its row. */
  const lines = (x: number, y: number, w: number, content: Typeset, height = content.height): number => {
    box(x, y, w, height);
    content.lines.forEach((entry, i) => text(x + entry.x, y + INSET.y + (i + 1) * LEADING - 5, entry.text, entry.bold ? ' font-weight="600"' : ''));
    return y + height;
  };
  /** A box across the diagram holding one centred statement. */
  const statement = (y: number, content: string): number => {
    const wrapped = wrap(content, inner - 2 * INSET.x, SIZE);
    const height = 2 * INSET.y + wrapped.length * LEADING;
    box(MARGIN, y, inner, height);
    wrapped.forEach((entry, i) => text(middle, y + INSET.y + (i + 1) * LEADING - 5, entry, ' text-anchor="middle"'));
    return y + height;
  };

  // Enrollment: who was assessed, who was excluded beside the way down, who was randomized.
  phase(WORDS.enrollment, MARGIN + 11);
  let y = statement(MARGIN + 20, flow.assessed);
  if (flow.excluded) {
    const trunk = MARGIN + 96;
    const x = trunk + 40;
    const content = typeset(flow.excluded, width - MARGIN - x);
    const top = y + 14;
    const bottom = lines(x, top, width - MARGIN - x, content);
    line(`M${num(trunk)},${num((top + bottom) / 2)} H${num(x - 1)}`);
    line(`M${num(trunk)},${num(y)} V${num(bottom + 13)}`);
    y = bottom + 14;
  } else {
    line(`M${num(middle)},${num(y)} V${num(y + DROP.plain - 1)}`);
    y += DROP.plain;
  }
  y = statement(y, flow.randomized);

  // Allocation: the way down splits into the arms, and each row hangs from the last box in its column.
  const fork = y + 12;
  line(`M${num(middle)},${num(y)} V${num(fork)}`, false);
  line(`M${num(centre(0))},${num(fork)} H${num(centre(flow.arms - 1))}`, false);
  let tails = Array.from({ length: flow.arms }, () => fork);
  let joined = false;
  for (const row of flow.rows) {
    const top = Math.max(...tails) + (row.phase ? DROP.phase : DROP.plain);
    if (row.phase) phase(row.phase, top - 13);
    if ('across' in row) {
      const content = typeset(row.across, inner);
      if (joined) line(`M${num(middle)},${num(tails[0])} V${num(top - 1)}`);
      else tails.forEach((tail, arm) => line(`M${num(centre(arm))},${num(tail)} V${num(top - 1)}`));
      const bottom = lines(MARGIN, top, inner, content);
      tails = tails.map(() => bottom);
      joined = true;
      continue;
    }
    const cells = row.cells.map((cell) => (cell ? typeset(cell, COLUMN) : undefined));
    const height = Math.max(...cells.map((cell) => cell?.height ?? 0));
    cells.forEach((cell, arm) => {
      if (!cell) return;
      line(`M${num(centre(arm))},${num(tails[arm])} V${num(top - 1)}`);
      tails[arm] = lines(columnX(arm), top, COLUMN, cell, height);
    });
  }
  return svgDocument(width, Math.max(...tails) + MARGIN, `CONSORT 2025 participant flow${flow.study ? `: ${flow.study}` : ''}`, body);
}

export const consort: Guideline = {
  id: 'consort-2025',
  name: 'CONSORT 2025',
  scope: 'Reports of randomised trials',
  url: 'https://www.consort-spirit.org',
  documents: [{
    id: 'flow',
    label: 'Participant flow',
    description: 'Who was assessed, excluded, randomized, allocated to each arm, lost or discontinued, and analyzed, with the last run\'s count on each: read off the allocation gateway, the paths out of it, and the exits drawn on them.',
    draw: ({ study }) => {
      const flow = participantFlowOf(study.model);
      if (!flow) return { unavailable: 'This study allocates no one at random. A participant flow starts from an allocation gateway with two arms or more.' };
      return { svg: drawConsort(consortFlow(study.model, flow)) };
    },
  }],
};
