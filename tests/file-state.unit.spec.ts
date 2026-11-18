import { expect, test } from '@playwright/test';

import type { LinkSnapshot, LinkedFile, LinkState } from '@modeler/diagram/fileHandle';
import { describeFile, type FileStateInput, type Place } from '@modeler/navbar/fileState';

/** A linked file in `state`; only its name and timestamp reach the nav bar. */
const linked = (state: LinkState, message?: string): LinkSnapshot => ({
  file: { name: 'pilot.studyflow.yaml', seenModified: 1_000 } as LinkedFile,
  state,
  message,
});

/** Opened without a handle, as Firefox's and Safari's file input and a drop give it. */
const opened: LinkSnapshot = { file: null, state: 'clean', opened: { name: 'pilot.bpmn', format: {} as never } };

const BASE: FileStateInput = {
  link: { file: null, state: 'clean' },
  keepsBrowserCopy: true,
  writesToFile: true,
  formatAutoSaves: true,
  canPickFiles: true,
};

/** Each row: what differs from `BASE`, then the place, the subtitle, its tone, and the card's buttons. */
const ROWS: { situation: string; given: Partial<FileStateInput>; place: Place; says: string; tone?: string; buttons: string[] }[] = [
  { situation: 'no file, kept in this browser', given: {}, place: 'browser', says: 'Only in this browser', buttons: ['Save...'] },
  { situation: 'no file, auto-save off', given: { keepsBrowserCopy: false }, place: 'unsaved', says: 'Not saved', tone: 'warning', buttons: ['Save...'] },
  { situation: 'a copy, where a save can pick a file', given: { link: opened }, place: 'copy', says: 'Opened as a copy', buttons: ['Save...'] },
  { situation: 'a copy, where a save downloads', given: { link: opened, canPickFiles: false }, place: 'copy', says: 'Saves as a download', buttons: ['Download'] },
  { situation: 'linked and saved', given: { link: linked('clean') }, place: 'disk', says: 'On this computer · Saved', buttons: [] },
  { situation: 'linked, an edit on its way', given: { link: linked('dirty') }, place: 'disk', says: 'On this computer · Saving...', buttons: [] },
  { situation: 'linked image, edited', given: { link: linked('dirty'), formatAutoSaves: false }, place: 'disk', says: 'On this computer · Unsaved changes', buttons: ['Save'] },
  { situation: 'linked, writing to the file off', given: { link: linked('dirty'), writesToFile: false }, place: 'disk', says: 'On this computer · Unsaved changes', buttons: ['Save'] },
  { situation: 'reloaded, the browser asks again', given: { link: linked('blocked') }, place: 'disk', says: 'Needs permission', tone: 'warning', buttons: ['Allow editing'] },
  { situation: 'changed on disk', given: { link: linked('conflict', 'It changed.') }, place: 'disk', says: 'Changed on disk', tone: 'warning', buttons: ['Replace the file'] },
  { situation: 'the last write failed', given: { link: linked('error', 'disk full') }, place: 'disk', says: 'Save failed', tone: 'error', buttons: ['Try again'] },
];

test('the nav bar says where the study saves, how far it got, and what to do about it', () => {
  for (const { situation, given, place, says, tone, buttons } of ROWS) {
    const state = describeFile({ ...BASE, ...given });
    expect(state.place, situation).toBe(place);
    expect([state.status.where, state.status.label].filter(Boolean).join(' · '), situation).toBe(says);
    expect(state.status.tone, situation).toBe(tone);
    expect(state.actions.map((action) => action.label), situation).toEqual(buttons);
  }
});

test('the card says why in a sentence: the write\'s own error, and what an unsaved edit waits for', () => {
  expect(describeFile({ ...BASE, link: linked('conflict', 'It changed.') }).detail).toBe('It changed.');
  expect(describeFile({ ...BASE, link: linked('error', 'disk full') }).detail).toBe('The last write failed: disk full');
  expect(describeFile({ ...BASE, link: linked('dirty'), formatAutoSaves: false }).detail).toContain('An image waits');
  expect(describeFile({ ...BASE, link: linked('dirty'), writesToFile: false }).detail).toContain('Writing to the file is off');
  expect(describeFile({ ...BASE, link: linked('clean') }).lastSaved).toBe(1_000);
});
