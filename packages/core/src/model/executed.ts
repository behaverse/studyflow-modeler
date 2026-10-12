/**
 * The executed copy of a `.studyflow.yaml` file: the text the run was given, every byte of it, with what the run added
 * spliced in. A run adds two things to a study, its state (`state:`, which it writes whole) and each element's
 * `prov:Activity` records (in the element's `extensionElements`, where a re-run may replace one), so a line diff of the
 * registered file and its executed copy shows those additions alone, and the file's comments, folded text and short
 * forms stay as they were written. The `yaml` package is used here, and only here, for the one thing js-yaml does not
 * give, which is where in the text each node is. What the text says is still read by js-yaml, the study's own reader,
 * and the copy is kept only when it reads back as the study the run left.
 */
import { dump } from 'js-yaml';
import { isMap, isScalar, isSeq, parseDocument, type Document, type Node, type Pair, type Scalar, type YAMLMap } from 'yaml';

import { choreographyToProcessIn } from '@core/model/choreography';
import { StudyModel, isElement, type Element, type State, type Value } from '@core/model/index';
import type { Metamodel } from '@core/model/metamodel';
import { YAML_DUMP_OPTIONS } from '@core/model/spelling';
import { RESERVED_DOC_KEYS, readStudy, spelledElement, writeStudy } from '@core/model/yaml';

const ACTIVITY = 'prov:Activity';

/** The keys an element leads with, after which the writer puts its `extensionElements`. */
const LEADING = new Set(['id', 'type', 'name', 'documentation']);

/** A stretch of the text, from `start` to `end`, and what replaces it. */
type Edit = { start: number; end: number; text: string };

/** An element's mapping in the text, and the id it is written under when its list is keyed by id. */
type Found = { map: YAMLMap; key?: Scalar };

/** What a run changed in an element's entries: the records it took out, by their place among the element's records,
 * and the entries it added after the rest, all of them records. */
type Change = { dropped: number[]; added: Element[] };

const isRecord = (entry: unknown): boolean => isElement(entry) && entry.type === ACTIVITY;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const entriesOf = (element: Element): Value[] => (Array.isArray(element.extensionElements) ? element.extensionElements : []);
const keyIs = (pair: Pair, name: string): boolean => isScalar(pair.key) && String(pair.key.value) === name;

/** Where the line `offset` is on starts. */
const lineStart = (text: string, offset: number): number => text.lastIndexOf('\n', offset - 1) + 1;
/** Where the line after `offset` starts, or `offset` itself when a line starts there. */
const lineAfter = (text: string, offset: number): number => (offset === 0 || text[offset - 1] === '\n' ? offset : text.indexOf('\n', offset) + 1 || text.length);
const columnOf = (text: string, offset: number): number => offset - lineStart(text, offset);
/** `block`, YAML text, moved `column` spaces to the right; its empty lines stay empty. */
const indented = (block: string, column: number): string => block.replace(/^(?=.)/gm, ' '.repeat(column));
const yamlOf = (value: unknown): string => dump(value, YAML_DUMP_OPTIONS);

/** A `.studyflow.yaml` text read as `parseStudy` reads one; what the reader says about it was said when the run read it. */
function studyOf(text: string, metamodel: Metamodel): StudyModel {
  const model = new StudyModel(readStudy(text, metamodel, () => {}), metamodel);
  choreographyToProcessIn(model);
  return model;
}

/**
 * The text of the executed copy of `source`, the text of the `.studyflow.yaml` file a run was given, once the run has
 * left `executed`: the source with the run state written in place of its own, or at its end, and each element's new
 * records added to its `extensionElements` (a key of its own after the keys the element leads with, where it has none),
 * the records a re-run replaced taken out. An element written in braces on one line is rewritten as a block to take its
 * records. Undefined when the run changed more of the study than that, or the text spells an element the run stamped in
 * a way no record can be added to.
 */
export function executedText(source: string, executed: StudyModel): string | undefined {
  const { metamodel } = executed;
  const text = source.endsWith('\n') ? source : `${source}\n`;
  const doc = parseDocument(text);
  const top = doc.contents;
  if (doc.errors.length > 0 || !isMap(top) || top.flow) return undefined;
  let registered: StudyModel;
  try {
    registered = studyOf(text, metamodel);
  } catch {
    return undefined;
  }

  const edits: Edit[] = [];
  for (const element of registered.elements()) {
    const ran = executed.get(element.id);
    const change = ran && changeIn(entriesOf(element), entriesOf(ran));
    if (!change) return undefined;
    if (change.dropped.length === 0 && change.added.length === 0) continue;
    const found = foundIn(top, registered, element);
    const added = change.added.map((entry) => spelledElement(metamodel, entry));
    const made = found && recordEdits(text, doc, found, change.dropped, added);
    if (!made) return undefined;
    edits.push(...made);
  }
  const state = stateEdit(text, top, registered.study.state, executed.study.state);
  if (state) edits.push(state);

  const spliced = applied(text, edits);
  if (spliced === undefined) return undefined;
  try {
    return same(writeStudy(studyOf(spliced, metamodel).study, metamodel), writeStudy(executed.study, metamodel)) ? spliced : undefined;
  } catch {
    return undefined;
  }
}

/** How a run changed an element's entries, from `before` to `after`; undefined when it is no change a run makes, which
 * takes records out and adds records after the rest. */
function changeIn(before: Value[], after: Value[]): Change | undefined {
  const dropped: number[] = [];
  let kept = 0;
  let record = 0;
  for (const entry of before) {
    if (kept < after.length && same(entry, after[kept])) kept += 1;
    else if (isRecord(entry)) dropped.push(record);
    else return undefined;
    if (isRecord(entry)) record += 1;
  }
  const added = after.slice(kept);
  return added.every(isRecord) ? { dropped, added: added as Element[] } : undefined;
}

/** The mapping `element` is written as under `top`, the file's top level: found along the path from its root, as
 * `patchDoc` finds it in the file's tree. */
function foundIn(top: YAMLMap, model: StudyModel, element: Element): Found | undefined {
  const chain: Element[] = [];
  for (let at: Element | undefined = element; at; at = model.parentOf(at)) chain.unshift(at);
  const [root, ...path] = chain;
  let found = (RESERVED_DOC_KEYS.has(root.id ?? '') ? undefined : heldIn(top, root.id)) ?? heldIn(top.get('elements', true), root.id);
  for (const child of path) {
    const holder = model.holderOf(child);
    if (!found || !holder?.parent) return undefined;
    const value = found.map.get(holder.key, true);
    found = Array.isArray(holder.parent[holder.key]) ? heldIn(value, child.id) : isMap(value) ? { map: value } : undefined;
  }
  return found;
}

/** The mapping of the element `id` in `list`: a list keyed by id, as the writer spells one, or a plain list. */
function heldIn(list: unknown, id: string | undefined): Found | undefined {
  if (id === undefined) return undefined;
  if (isMap(list)) {
    const pair = list.items.find((item) => keyIs(item, id));
    return pair && isMap(pair.value) ? { map: pair.value, key: pair.key as Scalar } : undefined;
  }
  const item = isSeq(list) ? list.items.find((each) => isMap(each) && String(each.get('id')) === id) : undefined;
  return isMap(item) ? { map: item } : undefined;
}

/** Where the text of `pair` ends, its value's and any comment on its last line included. */
const endOf = (pair: Pair): number => ((pair.value as Node | null) ?? (pair.key as Node)).range![2];

/** The edits that take the records `dropped` names out of `found`, an element's mapping, and add `added` after its
 * entries; undefined when its `extensionElements` is not a list in block style. */
function recordEdits(text: string, doc: Document, { map, key }: Found, dropped: number[], added: Record<string, unknown>[]): Edit[] | undefined {
  if (map.flow) return [respelled(text, doc, map, key, dropped, added)];
  const pair = map.items.find((item) => keyIs(item, 'extensionElements'));
  if (!pair) {
    let lead: Pair | undefined;
    for (const item of map.items) {
      if (!isScalar(item.key) || !LEADING.has(String(item.key.value))) break;
      lead = item;
    }
    const start = lineAfter(text, lead ? endOf(lead) : map.range![2]);
    return [{ start, end: start, text: indented(yamlOf({ extensionElements: added }), columnOf(text, (map.items[0].key as Node).range![0])) }];
  }
  const list = pair.value;
  if (!isSeq(list) || list.flow) return undefined;
  const records = list.items.filter((item): item is YAMLMap => isMap(item) && item.get('type') === ACTIVITY);
  if (dropped.some((index) => !records[index])) return undefined;
  const edits = dropped.map((index): Edit => ({ start: lineStart(text, records[index].range![0]), end: lineAfter(text, records[index].range![2]), text: '' }));
  if (added.length > 0) {
    const start = lineAfter(text, list.range![2]);
    edits.push({ start, end: start, text: indented(yamlOf(added), columnOf(text, list.range![0])) });
  }
  return edits;
}

/** `map`, an element written in braces, as the block it becomes to take its records: what it says, read as written,
 * with the records `dropped` names taken out of its `extensionElements` and `added` after them. */
function respelled(text: string, doc: Document, map: YAMLMap, key: Scalar | undefined, dropped: number[], added: Record<string, unknown>[]): Edit {
  const body = map.toJS(doc) as Record<string, unknown>;
  let record = -1;
  const entries = Array.isArray(body.extensionElements) ? body.extensionElements : [];
  body.extensionElements = [...entries.filter((entry) => !(isRecord(entry) && dropped.includes(++record))), ...added];
  const block = yamlOf(body).replace(/\n$/, '');
  // Keyed by its id, the block starts on the line after the key; in a plain list, after the dash.
  if (key) return { start: text.indexOf(':', key.range![1]) + 1, end: map.range![1], text: `\n${indented(block, columnOf(text, key.range![0]) + 2)}` };
  const column = columnOf(text, map.range![0]);
  return { start: map.range![0], end: map.range![1], text: indented(block, column).slice(column) };
}

/** The edit that writes the run state `after` in place of `before`, the state the file holds under `top`: at the end of
 * the file when it holds none. */
function stateEdit(text: string, top: YAMLMap, before: State | undefined, after: State | undefined): Edit | undefined {
  if (same(before ?? {}, after ?? {})) return undefined;
  const block = after && Object.keys(after).length > 0 ? yamlOf({ state: after }) : '';
  const pair = top.items.find((item) => keyIs(item, 'state'));
  if (!pair) return { start: text.length, end: text.length, text: block };
  return { start: lineStart(text, (pair.key as Node).range![0]), end: lineAfter(text, endOf(pair)), text: block };
}

/** `text` with `edits` made; undefined when two of them overlap. */
function applied(text: string, edits: Edit[]): string | undefined {
  let out = '';
  let at = 0;
  for (const edit of edits.toSorted((a, b) => a.start - b.start)) {
    if (edit.start < at) return undefined;
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + text.slice(at);
}
