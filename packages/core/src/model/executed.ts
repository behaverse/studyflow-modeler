/**
 * The executed copy of a `.studyflow.yaml` file: the text the run was given, every byte of it, with what the run added
 * spliced in. A run adds two things to a study, its state (`state:`, which it writes whole) and each element's
 * `prov:Activity` records (its list of them, where a re-run may replace one), so a line diff of the registered file and
 * its executed copy shows those additions alone, and the file's comments, folded text and short forms stay as they were
 * written. What is added is written as the writer writes it ({@link documentText}). The `yaml` package's parser is used
 * here for the one thing js-yaml does not give, which is where in the text each node is. What the text says is still
 * read by js-yaml, the study's own reader, and the copy is kept only when it reads back as the study the run left.
 */
import { isMap, isScalar, isSeq, parseDocument, type Document, type Node, type Pair, type Scalar, type YAMLMap, type YAMLSeq } from 'yaml';

import { choreographyToProcessIn } from '@core/model/choreography';
import { StudyModel, isElement, type Element, type State, type Value } from '@core/model/index';
import type { Metamodel } from '@core/model/metamodel';
import { fileKey, modelKey } from '@core/model/names';
import { RESERVED_DOC_KEYS, documentText, readStudy, spelledElement, writeStudy } from '@core/model/yaml';

const ACTIVITY = 'prov:Activity';

/** The key an element's entries sit under, each under its type; BPMN's one list of them where their types interleave. */
const EXTENSIONS = 'extensions';
/** The keys an element may hold its entries under, the file's and BPMN's. */
const ENTRY_LISTS = [EXTENSIONS, 'extensionElements'];

/** A stretch of the text, from `start` to `end`, and what replaces it. */
type Edit = { start: number; end: number; text: string };

/** An element's mapping in the text, and the id it is written under when its list is keyed by id. */
type Found = { map: YAMLMap; key?: Scalar };

/** What a run changed in an element's entries: the records it took out, by their place among the element's records,
 * and the entries it added after the rest, all of them records. */
type Change = { dropped: number[]; added: Element[] };

/** Whether a key of an element's mapping comes after its entries: its documentation, a list of elements it holds. */
type Trailing = (key: string) => boolean;

const isRecord = (entry: unknown): boolean => isElement(entry) && entry.type === ACTIVITY;
/** Whether `item`, of BPMN's one list of entries in the text, is a record. */
const isRecordMap = (item: unknown): boolean => isMap(item) && item.get('type') === ACTIVITY;
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
/** What `value` is written as under `key`: its lines, at column 0. */
const heldText = (key: string, value: unknown): string => documentText({ [key]: value }).replace(/^.*\n/, '').replace(/^ {2}/gm, '');

/** A `.studyflow.yaml` text read as `parseStudy` reads one; what the reader says about it was said when the run read it. */
function studyOf(text: string, metamodel: Metamodel): StudyModel {
  const model = new StudyModel(readStudy(text, metamodel, () => {}), metamodel);
  choreographyToProcessIn(model);
  return model;
}

/**
 * The text of the executed copy of `source`, the text of the `.studyflow.yaml` file a run was given, once the run has
 * left `executed`: the source with the run state written in place of its own, or at its end, and each element's new
 * records added to the `prov:Activity` list of its `extensions` (added to them, or `extensions` of its own before the
 * element's documentation and the elements it holds, where it has none), the records a re-run replaced taken out. An
 * element written in braces on one line, or whose `extensions` are, is rewritten as a block to take its records.
 * Undefined when the run changed more of the study than that, or the text spells an element the run stamped in a way
 * no record can be added to.
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
    const added = change.added.map((entry) => spelledElement(metamodel, entry, ACTIVITY));
    const made = found && recordEdits(text, doc, found, change.dropped, added, trailingOf(registered, element));
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

/** The keys the writer puts after `element`'s entries ({@link Trailing}), by the property each names on its BPMN element. */
function trailingOf(model: StudyModel, element: Element): Trailing {
  const { metamodel } = model;
  const host = model.host(element);
  const own = metamodel.has(host) ? metamodel.descriptor(host).propertiesByName : {};
  return (key) => {
    const p = own[modelKey(metamodel, host, key)];
    return !!p?.isMany && !p.isReference && metamodel.has(p.type);
  };
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
    const value = found.map.get(fileKey(model.metamodel, model.host(holder.parent), holder.key), true) ?? found.map.get(holder.key, true);
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
 * records: to the `prov:Activity` list of its `extensions`, or to the one straight on the element or BPMN's one list
 * of entries where the text keeps one of those, or under `extensions` of their own before its `trailing` keys.
 * Undefined when the list they go to is not in block style. */
function recordEdits(text: string, doc: Document, { map, key }: Found, dropped: number[], added: Record<string, unknown>[], trailing: Trailing): Edit[] | undefined {
  const entries = map.items.find((item) => ENTRY_LISTS.some((name) => keyIs(item, name)));
  const held = entries?.value;
  // An element written in braces, or one whose entries are, is respelled as a block.
  if (map.flow || ((isMap(held) || isSeq(held)) && held.flow)) return [respelled(text, doc, map, key, dropped, added, trailing)];
  // BPMN's one list of entries takes the records among them, each with its type.
  if (isSeq(held)) return listEdits(text, held, held.items.filter(isRecordMap), dropped, added.map((record) => ({ type: ACTIVITY, ...record })), String((entries!.key as Scalar).value));
  const holder = isMap(held) ? held : map;
  const listed = map.items.find((item) => keyIs(item, ACTIVITY)) ?? holder.items.find((item) => keyIs(item, ACTIVITY));
  if (listed) {
    const list = listed.value;
    if (!isSeq(list) || list.flow) return undefined;
    if (added.length === 0 && dropped.length === list.items.length) {
      // Its last record gone, the list goes, and the `extensions` that held nothing else.
      const gone = holder !== map && holder.items.length === 1 && holder.items[0] === listed ? entries! : listed;
      return [{ start: lineStart(text, (gone.key as Node).range![0]), end: lineAfter(text, endOf(gone)), text: '' }];
    }
    return listEdits(text, list, list.items, dropped, added, ACTIVITY);
  }
  if (dropped.length > 0) return undefined;
  if (holder !== map) {
    // The element's `extensions` take a `prov:Activity` list after their last entry.
    const start = lineAfter(text, endOf(holder.items[holder.items.length - 1]));
    return [{ start, end: start, text: indented(heldText(EXTENSIONS, { [ACTIVITY]: added }), columnOf(text, (holder.items[0].key as Node).range![0])) }];
  }
  const before = map.items.find((item) => isScalar(item.key) && trailing(String(item.key.value)));
  const start = before ? lineStart(text, (before.key as Node).range![0]) : lineAfter(text, endOf(map.items[map.items.length - 1]));
  return [{ start, end: start, text: indented(documentText({ [EXTENSIONS]: { [ACTIVITY]: added } }), columnOf(text, (map.items[0].key as Node).range![0])) }];
}

/** The edits that take out the lines of the records `dropped` names among `records`, the records `list` holds, and add
 * `added` after `list`'s last item, written as under `key`. Undefined when a record `dropped` names is not there. */
function listEdits(text: string, list: YAMLSeq, records: unknown[], dropped: number[], added: Record<string, unknown>[], key: string): Edit[] | undefined {
  if (dropped.some((index) => !records[index])) return undefined;
  const edits = dropped.map((index): Edit => ({ start: lineStart(text, (records[index] as Node).range![0]), end: lineAfter(text, (records[index] as Node).range![2]), text: '' }));
  if (added.length > 0) {
    const start = lineAfter(text, list.range![2]);
    edits.push({ start, end: start, text: indented(heldText(key, added), columnOf(text, list.range![0])) });
  }
  return edits;
}

/** `map`, an element written in braces, as the block it becomes to take its records: what it says, read as written,
 * with its records changed ({@link withRecords}). */
function respelled(text: string, doc: Document, map: YAMLMap, key: Scalar | undefined, dropped: number[], added: Record<string, unknown>[], trailing: Trailing): Edit {
  const block = heldText('element', withRecords(map.toJS(doc) as Record<string, unknown>, dropped, added, trailing)).replace(/\n$/, '');
  // Keyed by its id, the block starts on the line after the key; in a plain list, after the dash.
  if (key) return { start: text.indexOf(':', key.range![1]) + 1, end: map.range![1], text: `\n${indented(block, columnOf(text, key.range![0]) + 2)}` };
  const column = columnOf(text, map.range![0]);
  return { start: map.range![0], end: map.range![1], text: indented(block, column).slice(column) };
}

/** `body`, an element as written, with the records `dropped` names taken out and `added` after the rest, where
 * {@link recordEdits} puts them. */
function withRecords(body: Record<string, unknown>, dropped: number[], added: Record<string, unknown>[], trailing: Trailing): Record<string, unknown> {
  const kept = (list: unknown[], counted: (entry: unknown) => boolean): unknown[] => {
    let record = -1;
    return list.filter((entry) => !(counted(entry) && dropped.includes(++record)));
  };
  if (Array.isArray(body[ACTIVITY])) return { ...body, [ACTIVITY]: [...kept(body[ACTIVITY], () => true), ...added] };
  const name = ENTRY_LISTS.find((candidate) => candidate in body);
  const held = name === undefined ? undefined : body[name];
  if (Array.isArray(held)) return { ...body, [name!]: [...kept(held, isRecord), ...added.map((record) => ({ type: ACTIVITY, ...record }))] };
  if (held && typeof held === 'object') {
    const records = (held as Record<string, unknown>)[ACTIVITY];
    const listed = Array.isArray(records) ? records : records === undefined ? [] : [records];
    return { ...body, [name!]: { ...(held as Record<string, unknown>), [ACTIVITY]: [...kept(listed, () => true), ...added] } };
  }
  const entries = Object.entries(body);
  const at = entries.findIndex(([key]) => trailing(key));
  entries.splice(at < 0 ? entries.length : at, 0, [EXTENSIONS, { [ACTIVITY]: added }]);
  return Object.fromEntries(entries);
}

/** The edit that writes the run state `after` in place of `before`, the state the file holds under `top`: at the end of
 * the file, after a blank line, when it holds none. */
function stateEdit(text: string, top: YAMLMap, before: State | undefined, after: State | undefined): Edit | undefined {
  if (same(before ?? {}, after ?? {})) return undefined;
  const block = after && Object.keys(after).length > 0 ? documentText({ state: after }) : '';
  const pair = top.items.find((item) => keyIs(item, 'state'));
  if (!pair) return { start: text.length, end: text.length, text: block && `\n${block}` };
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
