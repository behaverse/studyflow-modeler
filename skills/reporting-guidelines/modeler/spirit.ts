/**
 * SPIRIT 2025 (Chan et al., 2025): the schedule of enrolment, interventions and assessments a protocol shows, as a
 * table of what happens at each time point. It is read off the rows the Schedule view charts, so the table and the
 * chart cannot disagree about a time:
 * - a column is a visit: the onset of an element that sits directly in its process, or of the sub-process holding it
 *   (the tasks of a session are marked at the session). Allocation takes a column of its own;
 * - a study period is a lane, named as the diagram names it, over the columns of the elements in it;
 * - a row is a scheduled element: what comes before the allocation gateway under enrollment, what only one arm does
 *   under interventions, a task or a questionnaire (the `instrument` role) under assessments, and the rest under the
 *   lane it sits in;
 * - a wait (a timer event) is no visit: it is drawn as a bar from the visit before it to where it ends.
 */
import { isExpandable } from '@core/document/outline';
import { idOf, isElement, type Element, type StudyModel } from '@core/model/index';
import { collectScheduleRows, tickLabel, type Row } from '@modeler/schedule/rows';
import type { Guideline } from '@skills/reporting-guidelines/modeler/guideline';
import { hasRole, laneOf, nameOf, participantFlowOf, topLevelIn, type ParticipantFlow } from '@skills/reporting-guidelines/modeler/participantFlow';
import { INK, escapeXml, num, svgDocument, withoutCount, wrap } from '@skills/reporting-guidelines/modeler/svg';

const WORDS = {
  period: 'Study period',
  timepoint: 'Time point',
  enrollment: 'Enrollment',
  allocation: 'Allocation',
  interventions: 'Interventions',
  assessments: 'Assessments',
  other: 'Other procedures',
} as const;

/** One line of the table: where it is marked, and from which column to which it lasts. */
export type Item = { label: string; color?: string; marks: number[]; bars: [number, number][] };

export type Schedule = {
  study: string;
  /** The study periods over the columns, each as many columns wide as it holds; none when the study draws no lanes. */
  periods: { name: string; span: number }[];
  /** The time points, each as the Schedule view's axis writes it (`T0`, `+5 min`). */
  columns: string[];
  sections: { title: string; items: Item[] }[];
};

/** When a column falls: before the allocation, at it, after it, or at the end of the last wait. */
type Phase = 0 | 1 | 2 | 3;
type Column = { phase: Phase; minutes: number };

const isWait = (model: StudyModel, element: Element): boolean => model.isA(element, 'bpmn:CatchEvent') && !model.isA(element, 'bpmn:StartEvent')
  && (Array.isArray(element.eventDefinitions) ? element.eventDefinitions : []).some((definition) => isElement(definition) && definition.type === 'bpmn:TimerEventDefinition');

/** The lane `element` sits in, by name, else the pool whose process holds it. */
function placeOf(model: StudyModel, element: Element): string | undefined {
  let process: Element | undefined;
  for (let at = model.parentOf(element); at; at = model.parentOf(at)) if (model.isA(at, 'bpmn:Process')) process = at;
  if (!process) return undefined;
  const top = topLevelIn(model, process, element);
  const lane = top?.id ? laneOf(process, top.id) : undefined;
  if (lane) return nameOf(model, lane) || undefined;
  const pools = model.study.roots.filter((root) => model.isA(root, 'bpmn:Collaboration'))
    .flatMap((collaboration) => (Array.isArray(collaboration.participants) ? collaboration.participants.filter(isElement) : []));
  return nameOf(model, pools.find((pool) => idOf(pool.processRef) === process!.id)) || undefined;
}

/** The schedule `rows` make, the Schedule view's own; nothing when none of them has a time. */
export function spiritSchedule(model: StudyModel, rows: readonly Row[], flow: ParticipantFlow | undefined = participantFlowOf(model)): Schedule | undefined {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const read = rows.flatMap((row) => {
    const element = model.get(row.id);
    if (!element) return [];
    const top = flow ? topLevelIn(model, flow.container, element) : undefined;
    const region = top?.id ? flow!.region(top.id) : undefined;
    // A container is a visit, its rows marked there, unless it is what one arm alone does: then it is that arm's
    // intervention, and a row of its own.
    if (row.group && !(typeof region === 'object' && top === element)) return [];
    // The visit a row belongs to: the outermost sub-process around it, else itself.
    let visit = row;
    for (let parent = byId.get(row.parent ?? ''); parent; parent = byId.get(parent.parent ?? '')) if (isExpandable(parent.type)) visit = parent;
    const wait = isWait(model, element);
    const place = placeOf(model, element);
    const section = region === 'before' ? 'enrollment'
      : typeof region === 'object' && top === element && !wait ? 'interventions'
        : hasRole(model, element, 'instrument') ? 'assessments'
          : `in ${place ?? ''}`;
    return [{ row, wait, place, section, phase: (region === 'before' ? 0 : 2) as Phase, time: visit.onsetMin }];
  });

  const columns: Column[] = [];
  const columnAt = (phase: Phase, minutes: number): number => columns.findIndex((column) => column.phase === phase && column.minutes === minutes);
  for (const { wait, phase, time } of read) if (!wait && time !== undefined && columnAt(phase, time) < 0) columns.push({ phase, minutes: time });
  if (columns.length === 0) return undefined;
  if (flow) {
    // Allocation follows the last thing before it: where what is scheduled before the gateway ends.
    const ends = read.filter((entry) => entry.phase === 0 && entry.row.onsetMin !== undefined).map((entry) => entry.row.onsetMin! + (entry.row.durationMin ?? 0));
    const after = columns.filter((column) => column.phase === 2).map((column) => column.minutes);
    columns.push({ phase: 1, minutes: ends.length > 0 ? Math.max(...ends) : after.length > 0 ? Math.min(...after) : 0 });
  }
  const lastVisit = Math.max(...columns.map((column) => column.minutes));
  const waitEnds = read.filter((entry) => entry.wait && entry.row.onsetMin !== undefined).map((entry) => entry.row.onsetMin! + (entry.row.durationMin ?? 0));
  if (waitEnds.length > 0 && Math.max(...waitEnds) > lastVisit) columns.push({ phase: 3, minutes: Math.max(...waitEnds) });
  columns.sort((a, b) => a.phase - b.phase || a.minutes - b.minutes);

  const sections = new Map<string, { title: string; items: Map<string, Item>; places: Set<string | undefined> }>();
  const sectionOf = (key: string, title: string) => sections.get(key) ?? sections.set(key, { title, items: new Map(), places: new Set() }).get(key)!;
  // SPIRIT's three come first, in its order, whichever the study names first.
  for (const [key, title] of [['enrollment', WORDS.enrollment], ['interventions', WORDS.interventions], ['assessments', WORDS.assessments]]) sectionOf(key, title);
  const itemOf = (key: string, title: string, label: string, color?: string): Item => {
    const { items } = sectionOf(key, title);
    return items.get(label) ?? items.set(label, { label, ...(color ? { color } : {}), marks: [], bars: [] }).get(label)!;
  };
  const mark = (item: Item, column: number): void => { if (!item.marks.includes(column)) item.marks.push(column); };
  const bar = (item: Item, from: number, to: number): void => { if (!item.bars.some(([a, b]) => a === from && b === to)) item.bars.push([from, to]); };
  /** The columns each period's name is read from: the first element marked there. */
  const periodAt = new Map<number, string | undefined>();

  for (const { row, wait, place, section, phase, time } of read) {
    const title = section.startsWith('in ') ? place ?? WORDS.other : '';
    const item = itemOf(section, title, withoutCount(row.label), row.stroke);
    sectionOf(section, title).places.add(place);
    const end = row.onsetMin === undefined ? undefined : row.onsetMin + (row.durationMin ?? 0);
    if (wait) {
      if (row.onsetMin === undefined) continue;
      // From the visit it follows to the first column at or past its end.
      const from = Math.max(0, columns.findLastIndex((column) => column.minutes <= row.onsetMin!));
      const to = columns.findIndex((column, index) => index > from && column.minutes >= end!);
      if (to > from) bar(item, from, to);
      else mark(item, from);
      if (!periodAt.has(to > from ? to : from) && columns[to > from ? to : from].phase === 3) periodAt.set(to > from ? to : from, place);
      continue;
    }
    if (time === undefined) continue;
    const at = columnAt(phase, time);
    if (!periodAt.has(at)) periodAt.set(at, place);
    // It lasts over each later visit that starts while it goes on.
    const last = columns.findLastIndex((column, index) => index > at && column.phase === 2 && end !== undefined && column.minutes < end);
    if (last > at) bar(item, at, last);
    else mark(item, at);
  }
  if (flow) {
    const at = columns.findIndex((column) => column.phase === 1);
    mark(itemOf('enrollment', WORDS.enrollment, WORDS.allocation), at);
    const lane = flow.allocation.id ? laneOf(flow.container, flow.allocation.id) : undefined;
    periodAt.set(at, nameOf(model, lane) || WORDS.allocation);
  }

  // The enrollment rows take their lane's name when they share one, as the periods do.
  const enrollment = sections.get('enrollment')!;
  const [place] = [...enrollment.places];
  if (enrollment.places.size === 1 && place) enrollment.title = place;

  const named = [...periodAt.entries()].some(([column, name]) => name !== undefined && columns[column].phase !== 1);
  const periods: Schedule['periods'] = [];
  if (named) {
    columns.forEach((_, index) => {
      const name = periodAt.get(index) ?? periods.at(-1)?.name ?? '';
      if (periods.at(-1)?.name === name) periods.at(-1)!.span += 1;
      else periods.push({ name, span: 1 });
    });
  }

  return {
    study: nameOf(model, model.primaryRoot()),
    periods,
    columns: columns.map((column) => tickLabel(column.minutes)),
    sections: [...sections.values()].filter((section) => section.items.size > 0)
      .map((section) => ({ title: section.title, items: [...section.items.values()].map((item) => ({ ...item, marks: [...item.marks].sort((a, b) => a - b) })) })),
  };
}

/* --- the drawing --- */

const SIZE = 12;
const LEADING = 16;
const MARGIN = 16;
const SECTION = 112;
const LABEL = 208;
const COLUMN = 76;
const HEAD = 22;
const DOT = 5;

/** The table as SVG. */
export function drawSpirit(schedule: Schedule): string {
  const left = MARGIN + SECTION + LABEL;
  const width = left + schedule.columns.length * COLUMN + MARGIN;
  const centre = (column: number): number => left + (column + 0.5) * COLUMN;
  const body: string[] = [];
  const text = (x: number, y: number, content: string, attributes = ''): void => {
    body.push(`<text x="${num(x)}" y="${num(y)}"${attributes}>${escapeXml(content)}</text>`);
  };
  const rule = (x1: number, y1: number, x2: number, y2: number, stroke: string, strokeWidth = 1): void => {
    body.push(`<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${stroke}" stroke-width="${num(strokeWidth)}"/>`);
  };

  // The head: the study periods over the time points they hold.
  let y = MARGIN;
  if (schedule.periods.length > 0) {
    text(MARGIN, y + 15, WORDS.period, ` fill="${INK.muted}"`);
    let column = 0;
    for (const { name, span } of schedule.periods) {
      const from = left + column * COLUMN;
      const lines = wrap(name, span * COLUMN - 8, SIZE, true);
      lines.forEach((line, i) => text(from + (span * COLUMN) / 2, y + 15 + i * LEADING - (lines.length - 1) * LEADING, line, ' text-anchor="middle" font-weight="600"'));
      if (column > 0) rule(from, y + 2, from, y + HEAD - 2, INK.rule);
      column += span;
    }
    y += HEAD;
  }
  text(MARGIN, y + 15, WORDS.timepoint, ` fill="${INK.muted}"`);
  schedule.columns.forEach((label, column) => text(centre(column), y + 15, label, ` text-anchor="middle" fill="${INK.muted}"`));
  y += HEAD;
  const top = y;
  rule(MARGIN, y, width - MARGIN, y, INK.stroke, 1.4);

  for (const [index, section] of schedule.sections.entries()) {
    if (index > 0) rule(MARGIN, y, width - MARGIN, y, INK.rule);
    const title = wrap(section.title, SECTION - 10, SIZE, true);
    let titled = false;
    for (const item of section.items) {
      const label = wrap(item.label, LABEL - 10, SIZE);
      const height = Math.max(label.length, titled ? 1 : title.length) * LEADING + 8;
      if (!titled) title.forEach((line, i) => text(MARGIN, y + 4 + (i + 1) * LEADING - 4, line, ' font-weight="600"'));
      titled = true;
      const color = item.color ?? INK.stroke;
      label.forEach((line, i) => text(MARGIN + SECTION, y + 4 + (i + 1) * LEADING - 4, line, item.color ? ` fill="${item.color}"` : ''));
      const middle = y + 4 + LEADING / 2;
      for (const [from, to] of item.bars) {
        body.push(`<line x1="${num(centre(from))}" y1="${num(middle)}" x2="${num(centre(to))}" y2="${num(middle)}" stroke="${color}" stroke-width="6" stroke-opacity="0.5" stroke-linecap="round"/>`);
      }
      for (const column of new Set([...item.marks, ...item.bars.flat()])) {
        body.push(`<circle cx="${num(centre(column))}" cy="${num(middle)}" r="${DOT}" fill="${color}"/>`);
      }
      y += height;
    }
  }
  rule(MARGIN, y, width - MARGIN, y, INK.stroke, 1.4);
  schedule.columns.forEach((_, column) => rule(left + column * COLUMN, top, left + column * COLUMN, y, INK.rule));
  return svgDocument(width, y + MARGIN, `SPIRIT 2025 schedule of enrollment, interventions and assessments${schedule.study ? `: ${schedule.study}` : ''}`, body);
}

export const spirit: Guideline = {
  id: 'spirit-2025',
  name: 'SPIRIT 2025',
  scope: 'Protocols of randomised trials',
  url: 'https://www.consort-spirit.org',
  documents: [{
    id: 'schedule',
    label: 'Schedule',
    description: 'What happens at each time point, as a table of enrollment, interventions and assessments: read off the onsets and durations the Schedule view charts, with each lane a study period.',
    draw: (modeler) => {
      const schedule = spiritSchedule(modeler.study.model, collectScheduleRows(modeler));
      if (!schedule) return { unavailable: 'Nothing is scheduled yet. Give an element an onset or a duration in the inspector.' };
      return { svg: drawSpirit(schedule) };
    },
  }],
};
